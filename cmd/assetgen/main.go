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

package main

import (
	"flag"
	"log"

	"github.com/ghmer/rego-adventure/cmd/assetgen/tools/assetgen"
)

func main() {
	themeName := flag.String("theme", "", "Name of the quest pack theme to generate")
	outputDir := flag.String("output", "", "Output directory for generated assets")
	flag.Parse()

	if *themeName == "" {
		log.Fatal("Please provide a theme name using the -theme flag")
	}

	if *outputDir == "" {
		log.Fatal("Please provide an output directory using the -output flag")
	}

	if err := assetgen.GenerateTheme(*themeName, *outputDir); err != nil {
		log.Fatalf("Failed to generate theme: %v", err)
	}
}
