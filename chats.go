package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type ChatUsage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
	LastPromptTokens int `json:"lastPromptTokens"`
}

type ChatLogEntry struct {
	Kind    string `json:"kind"`
	Content string `json:"content"`
	CallID  string `json:"callId,omitempty"`
	Name    string `json:"name,omitempty"`
	Args    string `json:"args,omitempty"`
	Status  string `json:"status,omitempty"`
	Result  string `json:"result,omitempty"`
	TS      int64  `json:"ts"`
}

type ChatSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Group     string    `json:"group"`
	HostID    string    `json:"hostId"`
	Archived  bool      `json:"archived"`
	CreatedAt int64     `json:"createdAt"`
	UpdatedAt int64     `json:"updatedAt"`
	Usage     ChatUsage `json:"usage"`
	Busy      bool      `json:"busy"`
}

type Chat struct {
	ChatSummary
	Log      []ChatLogEntry `json:"log"`
	Messages []chatMessage  `json:"messages"`
}

type ChatDetail struct {
	ChatSummary
	Log []ChatLogEntry `json:"log"`
}

type ChatStore struct {
	mu    sync.Mutex
	dir   string
	chats map[string]*Chat
	emit  func(name string, args ...interface{})
}

func NewChatStore() (*ChatStore, error) {
	dir := filepath.Join(dataDir(), "chats")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	cs := &ChatStore{dir: dir, chats: make(map[string]*Chat)}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var c Chat
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, fmt.Errorf("chat file %s is corrupted: %w", e.Name(), err)
		}
		if c.ID == "" {
			c.ID = strings.TrimSuffix(e.Name(), ".json")
		}
		cs.chats[c.ID] = &c
	}
	return cs, nil
}

func (cs *ChatStore) setEmit(fn func(name string, args ...interface{})) {
	cs.emit = fn
}

func (cs *ChatStore) emitEvent(name string, args ...interface{}) {
	if cs.emit != nil {
		cs.emit(name, args...)
	}
}

func (cs *ChatStore) persist(c *Chat) error {
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(cs.dir, c.ID+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func nowMs() int64 { return time.Now().UnixMilli() }

func (cs *ChatStore) summary(c *Chat) ChatSummary {
	s := c.ChatSummary
	return s
}

func (cs *ChatStore) List() []ChatSummary {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	out := make([]ChatSummary, 0, len(cs.chats))
	for _, c := range cs.chats {
		out = append(out, c.ChatSummary)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (cs *ChatStore) Get(id string) (*Chat, bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[id]
	if !ok {
		return nil, false
	}
	cp := *c
	cp.Log = append([]ChatLogEntry(nil), c.Log...)
	cp.Messages = append([]chatMessage(nil), c.Messages...)
	return &cp, true
}

func (cs *ChatStore) GetSummary(id string) (ChatSummary, bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[id]
	if !ok {
		return ChatSummary{}, false
	}
	return c.ChatSummary, true
}

func (cs *ChatStore) Create(hostID string) (ChatSummary, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	now := nowMs()
	c := &Chat{ChatSummary: ChatSummary{
		ID:        uuid.NewString(),
		HostID:    hostID,
		CreatedAt: now,
		UpdatedAt: now,
	}}
	c.Log = []ChatLogEntry{}
	c.Messages = []chatMessage{}
	if err := cs.persist(c); err != nil {
		return ChatSummary{}, err
	}
	cs.chats[c.ID] = c
	cs.emitEvent("chat:updated", c.ChatSummary)
	return c.ChatSummary, nil
}

func (cs *ChatStore) touch(c *Chat) {
	c.UpdatedAt = nowMs()
}

func (cs *ChatStore) mutate(id string, fn func(c *Chat)) (ChatSummary, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[id]
	if !ok {
		return ChatSummary{}, fmt.Errorf("chat not found")
	}
	fn(c)
	if err := cs.persist(c); err != nil {
		return ChatSummary{}, err
	}
	cs.emitEvent("chat:updated", c.ChatSummary)
	return c.ChatSummary, nil
}

func (cs *ChatStore) Rename(id, title string) (ChatSummary, error) {
	return cs.mutate(id, func(c *Chat) {
		c.Title = title
		cs.touch(c)
	})
}

func (cs *ChatStore) SetGroup(id, group string) (ChatSummary, error) {
	return cs.mutate(id, func(c *Chat) {
		c.Group = group
		cs.touch(c)
	})
}

func (cs *ChatStore) Attach(id, hostID string) (ChatSummary, error) {
	return cs.mutate(id, func(c *Chat) {
		c.HostID = hostID
		cs.touch(c)
	})
}

func (cs *ChatStore) Archive(id string, archived bool) (ChatSummary, error) {
	return cs.mutate(id, func(c *Chat) {
		c.Archived = archived
		cs.touch(c)
	})
}

func (cs *ChatStore) Delete(id string) error {
	cs.mu.Lock()
	c, ok := cs.chats[id]
	if !ok {
		cs.mu.Unlock()
		return fmt.Errorf("chat not found")
	}
	delete(cs.chats, id)
	cs.mu.Unlock()
	path := filepath.Join(cs.dir, id+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	cs.emitEvent("chat:deleted", id)
	_ = c
	return nil
}

func (cs *ChatStore) DetachHost(hostID string) {
	cs.mu.Lock()
	var changed []ChatSummary
	for _, c := range cs.chats {
		if c.HostID == hostID {
			c.HostID = ""
			cs.touch(c)
			if err := cs.persist(c); err == nil {
				changed = append(changed, c.ChatSummary)
			}
		}
	}
	cs.mu.Unlock()
	for _, s := range changed {
		cs.emitEvent("chat:updated", s)
	}
}

func (cs *ChatStore) appendLog(chatID string, e ChatLogEntry) (*Chat, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	if !ok {
		return nil, fmt.Errorf("chat not found")
	}
	e.TS = nowMs()
	c.Log = append(c.Log, e)
	cs.touch(c)
	return c, cs.persist(c)
}

func (cs *ChatStore) updateTool(chatID, callID, status, result string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	if !ok {
		return fmt.Errorf("chat not found")
	}
	for i := len(c.Log) - 1; i >= 0; i-- {
		if c.Log[i].Kind == "tool" && c.Log[i].CallID == callID {
			c.Log[i].Status = status
			c.Log[i].Result = result
			break
		}
	}
	cs.touch(c)
	return cs.persist(c)
}

func (cs *ChatStore) setBusy(chatID string, busy bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if c, ok := cs.chats[chatID]; ok {
		c.Busy = busy
	}
}

func (cs *ChatStore) setMessages(chatID string, msgs []chatMessage) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	if !ok {
		return fmt.Errorf("chat not found")
	}
	c.Messages = msgs
	cs.touch(c)
	return cs.persist(c)
}

func (cs *ChatStore) addUsage(chatID string, u ChatUsage) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if c, ok := cs.chats[chatID]; ok {
		c.Usage.PromptTokens += u.PromptTokens
		c.Usage.CompletionTokens += u.CompletionTokens
		c.Usage.TotalTokens += u.TotalTokens
		c.Usage.LastPromptTokens = u.LastPromptTokens
	}
}

func (cs *ChatStore) setTitleIfEmpty(chatID, title string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if c, ok := cs.chats[chatID]; ok && c.Title == "" {
		c.Title = title
		c.UpdatedAt = nowMs()
		_ = cs.persist(c)
	}
}
