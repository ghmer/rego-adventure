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

package assetgen

import (
	"bytes"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
)

// The generated files' skeletons live as embedded text/template files in
// the templates directory, so a change edits the template file instead of
// a Go string constant. theme.css.tmpl composes its repeated blocks from
// {{define}} fragments (button reset, circular icon geometry, hover
// emphasis, legend badges), keeping single ownership of those patterns.
// The goldens_test.go byte-comparison guards the render output.
//
//go:embed templates/*.tmpl
var skeletonFS embed.FS

// skeletons is the parsed template set; execution happens per generated pack.
var skeletons = template.Must(template.ParseFS(skeletonFS, "templates/*.tmpl"))

// renderTemplate executes the named skeleton and writes it to outputName
// in dir. data carries the actions' fields (a README skeleton receives the
// theme name); plain skeletons take nil.
func renderTemplate(dir, name, outputName string, data any) error {
	var out bytes.Buffer
	if err := skeletons.ExecuteTemplate(&out, name, data); err != nil {
		return fmt.Errorf("executing template %s: %w", name, err)
	}
	return os.WriteFile(filepath.Join(dir, outputName), out.Bytes(), 0600)
}
