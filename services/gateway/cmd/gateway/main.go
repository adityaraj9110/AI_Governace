package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// ── Config ──
// No provider API keys here — they come from the DB via Admin API
type Config struct {
	Port     string
	AdminAPI string // Admin API URL to resolve provider keys
	RedisAddr string
}

func loadConfig() Config {
	port := os.Getenv("GATEWAY_PORT")
	if port == "" { port = "8080" }
	return Config{
		Port:      port,
		AdminAPI:  getEnv("ADMIN_API_URL", "http://localhost:3001"),
		RedisAddr: getEnv("REDIS_URL", "localhost:6379"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" { return v }
	return fallback
}

// ── Provider Key (resolved from DB, not env) ──
type ProviderKey struct {
	APIKey  string `json:"api_key_encrypted"`
	BaseURL string `json:"base_url"`
	Name    string `json:"name"`
}

// ── Virtual Key metadata (resolved from DB) ──
type VirtualKeyMeta struct {
	ProviderID string
	Provider   string
	UserID     string
}

// ── Main ──
func main() {
	cfg := loadConfig()

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "gateway"})
	})

	// OpenAI-compatible endpoints
	mux.HandleFunc("POST /v1/chat/completions", withPipeline(cfg, handleChatCompletions))
	mux.HandleFunc("POST /v1/completions", withPipeline(cfg, handleCompletions))
	mux.HandleFunc("POST /v1/embeddings", withPipeline(cfg, handleEmbeddings))
	mux.HandleFunc("GET /v1/models", handleListModels(cfg))

	// Wrap with CORS + logging
	handler := corsMiddleware(loggingMiddleware(mux))

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("🚀 AI Gateway running on http://localhost:%s", cfg.Port)
		log.Printf("   Admin API: %s", cfg.AdminAPI)
		log.Printf("   Provider keys: resolved from DB (not env vars)")
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down gateway...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}

// ── Request Pipeline ──
func withPipeline(cfg Config, handler func(Config, http.ResponseWriter, *http.Request, *ProviderKey)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Step 1: Extract virtual key from Authorization header
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer vk-") {
			httpError(w, 401, "Missing or invalid Authorization header. Use: Bearer vk-<your-virtual-key>")
			return
		}

		virtualKey := strings.TrimPrefix(authHeader, "Bearer ")

		// Step 2: Hash the virtual key and resolve it from DB
		keyHash := hashKey(virtualKey)

		// Resolve virtual key → provider info from Admin API
		providerKey, err := resolveVirtualKey(cfg, keyHash)
		if err != nil {
			log.Printf("[PIPELINE] Key resolution failed for vk=%s: %s", virtualKey[:8]+"••••", err.Error())
			httpError(w, 403, "Invalid or revoked virtual key")
			return
		}

		// Step 3: Rate limiting (TODO: Redis sliding window)

		// Step 4: Forward to the user's provider using THEIR API key from DB
		handler(cfg, w, r, providerKey)

		log.Printf("[PIPELINE] %s %s → vk=%s → provider=%s → %dms",
			r.Method, r.URL.Path, virtualKey[:8]+"••••", providerKey.Name, time.Since(start).Milliseconds())
	}
}

// ── Resolve virtual key → provider key from Admin API ──
func resolveVirtualKey(cfg Config, keyHash string) (*ProviderKey, error) {
	// TODO: First check Redis cache, then fall back to Admin API
	// For now: call Admin API to resolve the virtual key

	// Look up the virtual key to get provider_id
	url := fmt.Sprintf("%s/api/v1/keys/resolve/%s", cfg.AdminAPI, keyHash)
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to reach Admin API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("key not found (status %d)", resp.StatusCode)
	}

	var result struct {
		Data struct {
			ProviderID string `json:"provider_id"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if result.Data.ProviderID == "" {
		return nil, fmt.Errorf("no provider linked to this key")
	}

	// Now get the provider's API key from the internal endpoint
	provURL := fmt.Sprintf("%s/api/v1/internal/providers/%s/key", cfg.AdminAPI, result.Data.ProviderID)
	provResp, err := http.Get(provURL)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve provider key: %w", err)
	}
	defer provResp.Body.Close()

	if provResp.StatusCode != 200 {
		return nil, fmt.Errorf("provider not found or inactive")
	}

	var provResult struct {
		Data ProviderKey `json:"data"`
	}
	json.NewDecoder(provResp.Body).Decode(&provResult)

	return &provResult.Data, nil
}

// ── Chat Completions Handler ──
// The provider's API key comes from the DB (resolved in pipeline), NOT from env vars
func handleChatCompletions(cfg Config, w http.ResponseWriter, r *http.Request, pk *ProviderKey) {
	// Read the incoming request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		httpError(w, 400, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	// Parse the OpenAI-format request
	var openaiReq map[string]interface{}
	if err := json.Unmarshal(body, &openaiReq); err != nil {
		httpError(w, 400, "Invalid JSON request body")
		return
	}

	// Get model from request
	model, _ := openaiReq["model"].(string)
	if model == "" { model = "gemini-2.0-flash" }

	// Route to the correct provider based on the user's stored provider config
	providerName := strings.ToLower(pk.Name)

	switch {
	case strings.Contains(providerName, "gemini") || strings.Contains(providerName, "google") || strings.Contains(pk.BaseURL, "googleapis.com"):
		forwardToGemini(w, pk, openaiReq, model)

	case strings.Contains(providerName, "anthropic") || strings.Contains(providerName, "claude") || strings.Contains(pk.BaseURL, "anthropic.com"):
		forwardToAnthropic(w, pk, openaiReq, model)

	default:
		// Default: OpenAI-compatible (works for OpenAI, Azure, Groq, Together, DeepSeek, Mistral, etc.)
		forwardToOpenAICompatible(w, pk, body)
	}
}

// ── Forward to Gemini (OpenAI → Gemini format conversion) ──
func forwardToGemini(w http.ResponseWriter, pk *ProviderKey, openaiReq map[string]interface{}, model string) {
	geminiReq := convertToGeminiFormat(openaiReq, model)

	geminiURL := fmt.Sprintf(
		"%s/v1beta/models/%s:generateContent?key=%s",
		strings.TrimRight(pk.BaseURL, "/"), model, pk.APIKey,
	)

	geminiBody, _ := json.Marshal(geminiReq)
	resp, err := http.Post(geminiURL, "application/json", strings.NewReader(string(geminiBody)))
	if err != nil {
		httpError(w, 502, "Failed to reach Gemini API: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	openaiResp := convertFromGeminiFormat(respBody, model)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	json.NewEncoder(w).Encode(openaiResp)
}

// ── Forward to OpenAI-compatible (passthrough) ──
func forwardToOpenAICompatible(w http.ResponseWriter, pk *ProviderKey, body []byte) {
	url := fmt.Sprintf("%s/v1/chat/completions", strings.TrimRight(pk.BaseURL, "/"))

	req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+pk.APIKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		httpError(w, 502, "Failed to reach provider API: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// Passthrough the response directly
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ── Forward to Anthropic (OpenAI → Anthropic format conversion) ──
func forwardToAnthropic(w http.ResponseWriter, pk *ProviderKey, openaiReq map[string]interface{}, model string) {
	// Convert OpenAI messages to Anthropic format
	messages, _ := openaiReq["messages"].([]interface{})
	var systemPrompt string
	var anthropicMsgs []map[string]string

	for _, msg := range messages {
		m, ok := msg.(map[string]interface{})
		if !ok { continue }
		role, _ := m["role"].(string)
		content, _ := m["content"].(string)

		if role == "system" {
			systemPrompt = content
			continue
		}
		anthropicMsgs = append(anthropicMsgs, map[string]string{"role": role, "content": content})
	}

	anthropicReq := map[string]interface{}{
		"model":      model,
		"max_tokens": 4096,
		"messages":   anthropicMsgs,
	}
	if systemPrompt != "" {
		anthropicReq["system"] = systemPrompt
	}
	if temp, ok := openaiReq["temperature"]; ok {
		anthropicReq["temperature"] = temp
	}
	if maxTok, ok := openaiReq["max_tokens"]; ok {
		anthropicReq["max_tokens"] = maxTok
	}

	reqBody, _ := json.Marshal(anthropicReq)
	url := fmt.Sprintf("%s/v1/messages", strings.TrimRight(pk.BaseURL, "/"))

	req, _ := http.NewRequest("POST", url, strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", pk.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		httpError(w, 502, "Failed to reach Anthropic API: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// Convert Anthropic response → OpenAI format
	openaiResp := convertFromAnthropicFormat(respBody, model)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	json.NewEncoder(w).Encode(openaiResp)
}

// ── Convert Anthropic response → OpenAI format ──
func convertFromAnthropicFormat(body []byte, model string) map[string]interface{} {
	var resp map[string]interface{}
	json.Unmarshal(body, &resp)

	responseText := ""
	if content, ok := resp["content"].([]interface{}); ok && len(content) > 0 {
		if block, ok := content[0].(map[string]interface{}); ok {
			responseText, _ = block["text"].(string)
		}
	}

	promptTokens := 0
	completionTokens := 0
	if usage, ok := resp["usage"].(map[string]interface{}); ok {
		if pt, ok := usage["input_tokens"].(float64); ok { promptTokens = int(pt) }
		if ct, ok := usage["output_tokens"].(float64); ok { completionTokens = int(ct) }
	}

	return map[string]interface{}{
		"id":      "chatcmpl-" + fmt.Sprintf("%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": responseText,
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]interface{}{
			"prompt_tokens":     promptTokens,
			"completion_tokens": completionTokens,
			"total_tokens":      promptTokens + completionTokens,
		},
	}
}

// ── Convert OpenAI → Gemini request ──
func convertToGeminiFormat(req map[string]interface{}, model string) map[string]interface{} {
	messages, _ := req["messages"].([]interface{})

	var contents []map[string]interface{}
	for _, msg := range messages {
		m, ok := msg.(map[string]interface{})
		if !ok { continue }

		role, _ := m["role"].(string)
		content, _ := m["content"].(string)

		geminiRole := "user"
		if role == "assistant" || role == "model" {
			geminiRole = "model"
		}
		if role == "system" {
			geminiRole = "user"
		}

		contents = append(contents, map[string]interface{}{
			"role":  geminiRole,
			"parts": []map[string]string{{"text": content}},
		})
	}

	result := map[string]interface{}{
		"contents": contents,
	}

	if temp, ok := req["temperature"]; ok {
		result["generationConfig"] = map[string]interface{}{
			"temperature": temp,
		}
	}
	if maxTok, ok := req["max_tokens"]; ok {
		gc, _ := result["generationConfig"].(map[string]interface{})
		if gc == nil { gc = map[string]interface{}{} }
		gc["maxOutputTokens"] = maxTok
		result["generationConfig"] = gc
	}

	return result
}

// ── Convert Gemini → OpenAI response ──
func convertFromGeminiFormat(body []byte, model string) map[string]interface{} {
	var geminiResp map[string]interface{}
	json.Unmarshal(body, &geminiResp)

	responseText := ""
	promptTokens := 0
	completionTokens := 0

	if candidates, ok := geminiResp["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if candidate, ok := candidates[0].(map[string]interface{}); ok {
			if content, ok := candidate["content"].(map[string]interface{}); ok {
				if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
					if part, ok := parts[0].(map[string]interface{}); ok {
						responseText, _ = part["text"].(string)
					}
				}
			}
		}
	}

	if usage, ok := geminiResp["usageMetadata"].(map[string]interface{}); ok {
		if pt, ok := usage["promptTokenCount"].(float64); ok { promptTokens = int(pt) }
		if ct, ok := usage["candidatesTokenCount"].(float64); ok { completionTokens = int(ct) }
	}

	return map[string]interface{}{
		"id":      "chatcmpl-" + fmt.Sprintf("%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": responseText,
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]interface{}{
			"prompt_tokens":     promptTokens,
			"completion_tokens": completionTokens,
			"total_tokens":      promptTokens + completionTokens,
		},
	}
}

// ── Completions handler (legacy) ──
func handleCompletions(cfg Config, w http.ResponseWriter, r *http.Request, pk *ProviderKey) {
	httpError(w, 501, "Legacy completions endpoint. Use /v1/chat/completions instead.")
}

// ── Embeddings handler ──
func handleEmbeddings(cfg Config, w http.ResponseWriter, r *http.Request, pk *ProviderKey) {
	httpError(w, 501, "Embeddings endpoint coming soon.")
}

// ── List Models (fetches from all active providers in DB) ──
func handleListModels(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Fetch all active providers from Admin API
		resp, err := http.Get(fmt.Sprintf("%s/api/v1/providers", cfg.AdminAPI))
		if err != nil {
			httpError(w, 502, "Failed to reach Admin API")
			return
		}
		defer resp.Body.Close()

		var result struct {
			Data []struct {
				Name   string                   `json:"name"`
				Models []map[string]interface{}  `json:"models"`
				Status string                   `json:"status"`
			} `json:"data"`
		}
		json.NewDecoder(resp.Body).Decode(&result)

		var models []map[string]interface{}
		for _, provider := range result.Data {
			if provider.Status != "active" { continue }
			for _, m := range provider.Models {
				modelID, _ := m["id"].(string)
				models = append(models, map[string]interface{}{
					"id":       modelID,
					"object":   "model",
					"owned_by": provider.Name,
					"created":  time.Now().Unix(),
				})
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"object": "list",
			"data":   models,
		})
	}
}

// ── Helpers ──
func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

func httpError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"message": message,
			"type":    "gateway_error",
		},
	})
}

// ── Middleware ──
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("[%s] %s %s %dms", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start).Milliseconds())
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
