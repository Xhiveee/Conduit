package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type chatMessage struct {
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	ToolCalls  []llmToolCall   `json:"tool_calls,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	Name       string          `json:"name,omitempty"`
}

type llmToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type llmTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
	} `json:"function"`
}

type chatRequest struct {
	Model      string          `json:"model"`
	Messages   []chatMessage   `json:"messages"`
	Tools      []llmTool       `json:"tools,omitempty"`
	ToolChoice string          `json:"tool_choice,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message      chatMessage `json:"message"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

var llmHTTP = &http.Client{Timeout: 180 * time.Second}

func newLLMTool(name, description, parameters string) llmTool {
	t := llmTool{Type: "function"}
	t.Function.Name = name
	t.Function.Description = description
	t.Function.Parameters = json.RawMessage(parameters)
	return t
}

func chatCompletion(ctx context.Context, cfg AISettings, messages []chatMessage, tools []llmTool) (*chatMessage, error) {
	if cfg.APIKey == "" && strings.Contains(cfg.BaseURL, "api.openai.com") {
		return nil, fmt.Errorf("API key is required for api.openai.com")
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	reqBody := chatRequest{
		Model:      cfg.Model,
		Messages:   messages,
		Tools:      tools,
		ToolChoice: "auto",
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}
	resp, err := llmHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("invalid response from LLM endpoint: %s", truncateMiddle(string(body), 500))
	}
	if resp.StatusCode != http.StatusOK {
		msg := fmt.Sprintf("LLM request failed: HTTP %d", resp.StatusCode)
		if parsed.Error != nil && parsed.Error.Message != "" {
			msg += ": " + parsed.Error.Message
		}
		return nil, fmt.Errorf("%s", msg)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("LLM error: %s", parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("LLM returned no choices")
	}
	return &parsed.Choices[0].Message, nil
}
