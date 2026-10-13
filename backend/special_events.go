package main

import "strings"

// A context window size is metadata, not evidence that the limit was reached.
func tokenLimitError(value string) bool {
	text := strings.ToLower(value)
	for _, marker := range []string{"context_length_exceeded", "context window exceeded", "context length exceeded", "maximum context length", "max_tokens", "token limit exceeded"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

func sourceErrorEvent(errorType, message string) (kind, label string) {
	switch {
	case errorType == "aborted":
		return "abort", "Session aborted"
	case tokenLimitError(errorType) || tokenLimitError(message):
		return "limit", "Model token limit reached"
	default:
		return "error", "Model error"
	}
}
