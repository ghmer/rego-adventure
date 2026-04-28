# Proposed Non-Boolean Quests (Startup Pack)

IDs 21–24. All use `apply_template: true`. Solutions verified against the correct Rego logic.

## Implementation note — normalizeValue

OPA returns numbers as `json.Number` through the Go rego.Eval API.
After JSON round-trip normalisation, ALL numbers become `float64`.
The expected_value numbers in JSON (0, 1, 2, 3) also unmarshal to `float64`.
So reflect.DeepEqual works for both sides.

For empty sets (Quest 23, test 2301): OPA returns `[]any{}` for an empty partial set.
After JSON round-trip this stays `[]any{}`. The JSON `[]` also decodes to `[]any{}`.
reflect.DeepEqual([]any{}, []any{}) == true.
IF OPA ever returns nil instead of empty slice, normalizeValue must coerce nil-slice to []any{}.

## Quest 21 — "The Status Update" (String output)

```json
{
  "id": 21,
  "title": "The Status Update",
  "description_lore": [
    "The on-call engineer is exhausted from receiving alerts that just say `false`. \"What does `false` even mean?!\" she yells into the void.",
    "\"Is it denied? Is it down? Is it an existential crisis?\"",
    "Help her out. Rewrite the rule to return the string `\"granted\"` or `\"denied\"` instead of a boolean."
  ],
  "description_task": "Define `access_status` to return `\"granted\"` if the user's role is `\"admin\"`, and `\"denied\"` otherwise.",
  "manual": {
    "data_model": "| Field | Description |\n|-------|-------------|\n| `input.user.role` | The role of the user |",
    "rego_snippet": "Rules can return any value, not just booleans:\n```rego\ndefault status := \"denied\"\nstatus := \"granted\" if condition\n```",
    "external_link": "https://www.openpolicyagent.org/docs/policy-reference#rules"
  },
  "hints": [
    "The `default` is already set to `\"denied\"`. You only need to handle the `\"granted\"` case.",
    "Add: `access_status := \"granted\" if input.user.role == \"admin\"`"
  ],
  "solution": "access_status := \"granted\" if input.user.role == \"admin\"",
  "apply_template": true,
  "template": "package play\nimport rego.v1\n\ndefault access_status := \"denied\"\n\n",
  "tests": [
    {
      "id": 2101,
      "payload": { "input": { "user": { "role": "admin" } } },
      "expected_value": "granted"
    },
    {
      "id": 2102,
      "payload": { "input": { "user": { "role": "intern" } } },
      "expected_value": "denied"
    },
    {
      "id": 2103,
      "payload": { "input": { "user": { "role": "engineer" } } },
      "expected_value": "denied"
    },
    {
      "id": 2104,
      "payload": { "input": { "user": { "role": "CTO" } } },
      "expected_value": "denied"
    }
  ],
  "query": "data.play.access_status"
}
```

## Quest 22 — "The Bug Counter" (Number output)

```json
{
  "id": 22,
  "title": "The Bug Counter",
  "description_lore": [
    "The deploy dashboard shows a traffic light. Green = ship. Red = panic.",
    "\"But HOW red?\" demands the VP of Engineering. \"I need a NUMBER. How many things are broken?\"",
    "Use `count()` to return the exact number of policy violations. Zero ships. Anything else means more all-hands meetings."
  ],
  "description_task": "Define `issue_count` as the number of active policy issues. An issue exists if `input.token` is missing, `input.suspended` is true, or `input.ip` is in `data.blocked_ips`.",
  "manual": {
    "data_model": "| Field | Description |\n|-------|-------------|\n| `input.token` | Auth token (optional — may be absent) |\n| `input.suspended` | Account suspended flag (boolean) |\n| `input.ip` | Client IP address (string) |\n| `data.blocked_ips` | List of blocked IP strings |",
    "rego_snippet": "Use `count()` to aggregate a partial set:\n```rego\nissues contains \"problem\" if condition\nissue_count := count(issues)\n```",
    "external_link": "https://www.openpolicyagent.org/docs/policy-reference#aggregates"
  },
  "hints": [
    "First collect problems into a partial set `issues`.",
    "Then derive `issue_count := count(issues)`.",
    "Use `not input.token` to detect a missing token field."
  ],
  "solution": "issues contains \"missing_token\" if not input.token\nissues contains \"account_suspended\" if input.suspended == true\nissues contains \"ip_blocked\" if input.ip in data.blocked_ips\n\nissue_count := count(issues)",
  "apply_template": true,
  "template": "package play\nimport rego.v1\n\n# Collect issues, then count them\n\n",
  "tests": [
    {
      "id": 2201,
      "payload": {
        "input": { "token": "abc123", "suspended": false, "ip": "1.2.3.4" },
        "data": { "blocked_ips": [] }
      },
      "expected_value": 0
    },
    {
      "id": 2202,
      "payload": {
        "input": { "suspended": false, "ip": "1.2.3.4" },
        "data": { "blocked_ips": [] }
      },
      "expected_value": 1
    },
    {
      "id": 2203,
      "payload": {
        "input": { "suspended": true, "ip": "1.2.3.4" },
        "data": { "blocked_ips": [] }
      },
      "expected_value": 2
    },
    {
      "id": 2204,
      "payload": {
        "input": { "suspended": true, "ip": "5.5.5.5" },
        "data": { "blocked_ips": ["5.5.5.5"] }
      },
      "expected_value": 3
    }
  ],
  "query": "data.play.issue_count"
}
```

## Quest 23 — "The Security Audit Report" (Array output from partial set)

> **Note:** OPA returns sets as **lexicographically sorted** JSON arrays.
> The expected_value arrays must be sorted. Verify: `"blocked_ip"` < `"expired_cert"` < `"no_mfa"` ✓

```json
{
  "id": 23,
  "title": "The Security Audit Report",
  "description_lore": [
    "The CISO slides a legal pad across the table. \"I don't want `false`. I want a LIST of exactly what's wrong.\"",
    "\"If MFA is off, say so. If the cert is expired, say so. Give me something I can put in the report.\"",
    "Write a rule that returns the full set of security violations. The auditor's billable hours are ticking."
  ],
  "description_task": "Define `violations` as a partial set. Add `\"no_mfa\"` if MFA is disabled, `\"expired_cert\"` if the certificate is expired, and `\"blocked_ip\"` if the IP is in `data.blocklist`.",
  "manual": {
    "data_model": "| Field | Description |\n|-------|-------------|\n| `input.mfa_enabled` | Boolean |\n| `input.cert_expired` | Boolean |\n| `input.ip` | Client IP (string) |\n| `data.blocklist` | List of blocked IPs |",
    "rego_snippet": "Partial set rules:\n```rego\nviolations contains \"msg\" if {\n  condition\n}\n```\nThe result is returned as a **sorted array** in JSON.",
    "external_link": "https://www.openpolicyagent.org/docs/policy-reference#incremental-rules"
  },
  "hints": [
    "Use `violations contains \"no_mfa\" if not input.mfa_enabled`.",
    "Use `violations contains \"expired_cert\" if input.cert_expired == true`.",
    "Use `violations contains \"blocked_ip\" if input.ip in data.blocklist`.",
    "The test expects a sorted array. OPA handles the sorting automatically."
  ],
  "solution": "violations contains \"blocked_ip\" if input.ip in data.blocklist\nviolations contains \"expired_cert\" if input.cert_expired == true\nviolations contains \"no_mfa\" if not input.mfa_enabled",
  "apply_template": true,
  "template": "package play\nimport rego.v1\n\n# Populate the violations set\n\n",
  "tests": [
    {
      "id": 2301,
      "payload": {
        "input": { "mfa_enabled": true, "cert_expired": false, "ip": "1.1.1.1" },
        "data": { "blocklist": [] }
      },
      "expected_value": []
    },
    {
      "id": 2302,
      "payload": {
        "input": { "mfa_enabled": false, "cert_expired": false, "ip": "1.1.1.1" },
        "data": { "blocklist": [] }
      },
      "expected_value": ["no_mfa"]
    },
    {
      "id": 2303,
      "payload": {
        "input": { "mfa_enabled": false, "cert_expired": true, "ip": "1.1.1.1" },
        "data": { "blocklist": [] }
      },
      "expected_value": ["expired_cert", "no_mfa"]
    },
    {
      "id": 2304,
      "payload": {
        "input": { "mfa_enabled": false, "cert_expired": true, "ip": "5.5.5.5" },
        "data": { "blocklist": ["5.5.5.5"] }
      },
      "expected_value": ["blocked_ip", "expired_cert", "no_mfa"]
    }
  ],
  "query": "data.play.violations"
}
```

## Quest 24 — "The Permission Matrix" (Object output)

```json
{
  "id": 24,
  "title": "The Permission Matrix",
  "description_lore": [
    "The RBAC system returned the wrong permissions again. The editor deleted the production database. \"I thought I only had write access!\" she wails.",
    "The bug: the editor rule accidentally copies the admin permissions — full delete access.",
    "Fix the rule. Editors can read and write. Only admins can delete. Simple."
  ],
  "description_task": "Fix the `editor` permissions rule. Editors should have `read: true`, `write: true`, and `delete: false`.",
  "manual": {
    "data_model": "| Field | Description |\n|-------|-------------|\n| `input.user.role` | The user's role (\"admin\", \"editor\", \"viewer\") |",
    "rego_snippet": "Complete rules can return objects:\n```rego\ndefault config := {\"flag\": false}\nconfig := {\"flag\": true} if condition\n```",
    "external_link": "https://www.openpolicyagent.org/docs/policy-reference#rules"
  },
  "hints": [
    "Find the `editor` rule in the template.",
    "Change `\"delete\": true` to `\"delete\": false` for the editor role."
  ],
  "solution": "default permissions := {\"delete\": false, \"read\": false, \"write\": false}\n\npermissions := {\"delete\": true, \"read\": true, \"write\": true} if input.user.role == \"admin\"\npermissions := {\"delete\": false, \"read\": true, \"write\": true} if input.user.role == \"editor\"\npermissions := {\"delete\": false, \"read\": true, \"write\": false} if input.user.role == \"viewer\"",
  "apply_template": true,
  "template": "package play\nimport rego.v1\n\ndefault permissions := {\"delete\": false, \"read\": false, \"write\": false}\n\npermissions := {\"delete\": true, \"read\": true, \"write\": true} if input.user.role == \"admin\"\n# BUG: editor should not be able to delete!\npermissions := {\"delete\": true, \"read\": true, \"write\": true} if input.user.role == \"editor\"\npermissions := {\"delete\": false, \"read\": true, \"write\": false} if input.user.role == \"viewer\"",
  "tests": [
    {
      "id": 2401,
      "payload": { "input": { "user": { "role": "admin" } } },
      "expected_value": { "delete": true, "read": true, "write": true }
    },
    {
      "id": 2402,
      "payload": { "input": { "user": { "role": "editor" } } },
      "expected_value": { "delete": false, "read": true, "write": true }
    },
    {
      "id": 2403,
      "payload": { "input": { "user": { "role": "viewer" } } },
      "expected_value": { "delete": false, "read": true, "write": false }
    },
    {
      "id": 2404,
      "payload": { "input": { "user": { "role": "intern" } } },
      "expected_value": { "delete": false, "read": false, "write": false }
    }
  ],
  "query": "data.play.permissions"
}
```
