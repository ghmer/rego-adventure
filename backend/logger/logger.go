/*
   Copyright 2025 Mario Enrico Ragucci

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// Package logger configures structured logging for the application.
// Setup is called explicitly from main so the log level is configurable
// and tests keep their own default logger.
package logger

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// slogLevelNames maps the accepted LOG_LEVEL names to slog levels.
// Parsing is done here rather than via a package-level parser so the
// accepted vocabulary is explicit and toolchain-independent.
var slogLevelNames = map[string]slog.Level{
	"debug": slog.LevelDebug,
	"info":  slog.LevelInfo,
	"warn":  slog.LevelWarn,
	"error": slog.LevelError,
}

// Setup installs the default slog JSON handler writing to stdout. The
// level accepts debug, info, warn, and error (case-insensitively); an
// empty level defaults to info. An unknown level is reported as an error
// instead of silently falling back, so a typo cannot hide log output.
func Setup(level string) error {
	if level == "" {
		level = "info"
	}

	parsed, ok := slogLevelNames[strings.ToLower(level)]
	if !ok {
		return fmt.Errorf("invalid LOG_LEVEL %q: want one of debug, info, warn, error", level)
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parsed})
	slog.SetDefault(slog.New(handler))
	return nil
}
