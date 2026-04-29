#!/usr/bin/env python3
import json
import re
from pathlib import Path
from collections import defaultdict
from datetime import datetime

ROOT = Path.home() / ".claude"

KEYWORDS = [
    "api",
    "apiKey",
    "api_key",
    "managed",
    "managed key",
    "subscription",
    "billing",
    "usage billing",
    "api usage billing",
    "organization",
    "org",
    "auth",
    "authToken",
    "auth_token",
    "oauth",
    "console",
    "claude_code_key",
    "max",
    "pro",
]

TARGET_SESSION_IDS = {
    "57893c7d-0c8b-46c3-b748-10495368eac0",
    "a493054a-0af9-4853-bd53-a80d8299c77d",
    "a0670d23-7aef-48e0-91f1-038bf93926f7",
    "0f46b1a9-1dc1-413f-a193-60e6f7b23da9",
}

def parse_ts(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None

def get_session_id(path: Path):
    parts = path.parts

    # ~/.claude/projects/<project>/<session>/subagents/file.jsonl
    if "projects" in parts:
        i = parts.index("projects")
        if len(parts) > i + 2:
            candidate = parts[i + 2]
            if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", candidate):
                return candidate

        # ~/.claude/projects/<project>/<session>.jsonl
        if path.name.endswith(".jsonl"):
            stem = path.name[:-6]
            if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", stem):
                return stem

    return None

def get_project(path: Path):
    parts = path.parts
    if "projects" in parts:
        i = parts.index("projects")
        if len(parts) > i + 1:
            return parts[i + 1]
    return "unknown"

def flatten(obj, prefix=""):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            out.append((key, v))
            out.extend(flatten(v, key))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = f"{prefix}[{i}]"
            out.extend(flatten(v, key))
    return out

def model_from_obj(obj):
    for path in (
        ("message", "model"),
        ("model",),
        ("response", "model"),
    ):
        cur = obj
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                ok = False
                break
        if ok and isinstance(cur, str):
            return cur
    return None

def usage_from_obj(obj):
    for path in (
        ("message", "usage"),
        ("usage",),
        ("response", "usage"),
    ):
        cur = obj
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                ok = False
                break
        if ok and isinstance(cur, dict):
            return cur
    return {}

def get_num(d, *keys):
    total = 0
    for k in keys:
        v = d.get(k, 0)
        if isinstance(v, (int, float)):
            total += v
    return total

sessions = defaultdict(lambda: {
    "project": "",
    "first": None,
    "last": None,
    "files": set(),
    "models": defaultdict(int),
    "input": 0,
    "output": 0,
    "cache_read": 0,
    "cache_write": 0,
    "keyword_hits": defaultdict(set),
    "api_key_hits": set(),
    "billing_hits": set(),
    "auth_hits": set(),
    "org_hits": set(),
    "subscription_hits": set(),
    "raw_evidence": [],
})

all_json_files = list(ROOT.rglob("*.json")) + list(ROOT.rglob("*.jsonl"))

for fp in all_json_files:
    sid = get_session_id(fp)

    # Also inspect global config files, but assign them to GLOBAL_CONFIG.
    if not sid and fp.suffix == ".json":
        sid = "GLOBAL_CONFIG"

    if not sid:
        continue

    rec = sessions[sid]
    rec["project"] = get_project(fp)
    rec["files"].add(str(fp))

    try:
        lines = fp.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        continue

    for line_no, line in enumerate(lines, start=1):
        text_line = line.strip()
        if not text_line:
            continue

        try:
            obj = json.loads(text_line)
        except json.JSONDecodeError:
            # Config files may be pretty JSON, parse whole file later if needed.
            continue

        ts = (
            parse_ts(obj.get("timestamp"))
            or parse_ts(obj.get("createdAt"))
            or parse_ts(obj.get("created_at"))
            or parse_ts(obj.get("time"))
        )
        if ts:
            if rec["first"] is None or ts < rec["first"]:
                rec["first"] = ts
            if rec["last"] is None or ts > rec["last"]:
                rec["last"] = ts

        model = model_from_obj(obj)
        if model:
            rec["models"][model] += 1

        usage = usage_from_obj(obj)
        if usage:
            rec["input"] += get_num(usage, "input_tokens")
            rec["output"] += get_num(usage, "output_tokens")
            rec["cache_read"] += get_num(usage, "cache_read_input_tokens")
            rec["cache_write"] += get_num(
                usage,
                "cache_creation_input_tokens",
                "cache_write_input_tokens",
                "cache_creation_input_tokens_5m",
                "cache_creation_input_tokens_1h",
            )

        flat = flatten(obj)

        for key, value in flat:
            key_l = str(key).lower()
            val_s = str(value)
            val_l = val_s.lower()

            combined = f"{key_l} {val_l}"

            for kw in KEYWORDS:
                if kw.lower() in combined:
                    rec["keyword_hits"][kw].add(f"{fp}:{line_no}:{key}={val_s[:160]}")

            if "claude_code_key" in val_l or "api key" in combined or "apikey" in combined or "api_key" in combined:
                rec["api_key_hits"].add(f"{fp}:{line_no}:{key}={val_s[:200]}")

            if "api usage billing" in combined or "usage billing" in combined or "billing" in key_l:
                rec["billing_hits"].add(f"{fp}:{line_no}:{key}={val_s[:200]}")

            if "auth" in key_l or "oauth" in combined or "token" in key_l:
                rec["auth_hits"].add(f"{fp}:{line_no}:{key}={val_s[:200]}")

            if "organization" in key_l or key_l.endswith(".org") or "individual org" in val_l:
                rec["org_hits"].add(f"{fp}:{line_no}:{key}={val_s[:200]}")

            if "subscription" in combined or "pro" == val_l or "max" == val_l:
                rec["subscription_hits"].add(f"{fp}:{line_no}:{key}={val_s[:200]}")

# Try parsing pretty JSON config files whole.
for fp in list(ROOT.rglob("*.json")):
    try:
        obj = json.loads(fp.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        continue

    sid = "GLOBAL_CONFIG"
    rec = sessions[sid]
    rec["project"] = "global"
    rec["files"].add(str(fp))

    for key, value in flatten(obj):
        key_l = str(key).lower()
        val_s = str(value)
        val_l = val_s.lower()
        combined = f"{key_l} {val_l}"

        if "claude_code_key" in val_l or "api key" in combined or "apikey" in combined or "api_key" in combined:
            rec["api_key_hits"].add(f"{fp}:{key}={val_s[:200]}")
        if "api usage billing" in combined or "usage billing" in combined or "billing" in key_l:
            rec["billing_hits"].add(f"{fp}:{key}={val_s[:200]}")
        if "auth" in key_l or "oauth" in combined or "token" in key_l:
            rec["auth_hits"].add(f"{fp}:{key}={val_s[:200]}")
        if "organization" in key_l or key_l.endswith(".org") or "individual org" in val_l:
            rec["org_hits"].add(f"{fp}:{key}={val_s[:200]}")
        if "subscription" in combined or "pro" == val_l or "max" == val_l:
            rec["subscription_hits"].add(f"{fp}:{key}={val_s[:200]}")

def classify(rec):
    api_score = 0
    sub_score = 0
    reasons = []

    if rec["api_key_hits"]:
        api_score += 5
        reasons.append("found API key / claude_code_key evidence")
    if rec["billing_hits"]:
        api_score += 3
        reasons.append("found billing/API usage billing evidence")
    if rec["org_hits"]:
        api_score += 2
        reasons.append("found organization evidence")
    if rec["subscription_hits"]:
        sub_score += 4
        reasons.append("found subscription/Pro/Max evidence")
    if rec["auth_hits"] and not rec["api_key_hits"]:
        sub_score += 1
        reasons.append("found auth/token evidence without explicit API key")

    if api_score > sub_score:
        return "LIKELY API BILLING", reasons
    if sub_score > api_score:
        return "POSSIBLY SUBSCRIPTION/OAUTH", reasons
    return "UNKNOWN FROM LOCAL LOGS", reasons

print("\nClaude billing-mode audit\n")
print("Note: Local JSONL may not always store billing mode. The most authoritative check is still Claude Code /status.\n")

wanted = list(TARGET_SESSION_IDS) + ["GLOBAL_CONFIG"]

for sid in wanted:
    if sid not in sessions:
        print("=" * 110)
        print(f"Session: {sid}")
        print("Not found in local logs/config.")
        continue

    rec = sessions[sid]
    mode, reasons = classify(rec)

    print("=" * 110)
    print(f"Session: {sid}")
    print(f"Project: {rec['project']}")
    print(f"Classification: {mode}")
    print(f"First event: {rec['first']}")
    print(f"Last event:  {rec['last']}")
    print(f"Files scanned: {len(rec['files'])}")
    print(f"Tokens: input={rec['input']:,} output={rec['output']:,} cache_read={rec['cache_read']:,} cache_write={rec['cache_write']:,}")

    print("Models:")
    if rec["models"]:
        for model, count in sorted(rec["models"].items(), key=lambda kv: kv[1], reverse=True):
            print(f"  {model}: {count:,} calls/events")
    else:
        print("  none found")

    print("Reasons:")
    if reasons:
        for r in reasons:
            print(f"  - {r}")
    else:
        print("  - no explicit billing/auth evidence found in this session log")

    def show_hits(title, hits, limit=8):
        print(title)
        if not hits:
            print("  none")
            return
        for h in sorted(hits)[:limit]:
            print(f"  {h}")
        if len(hits) > limit:
            print(f"  ... {len(hits) - limit} more")

    show_hits("API key evidence:", rec["api_key_hits"])
    show_hits("Billing evidence:", rec["billing_hits"])
    show_hits("Organization evidence:", rec["org_hits"])
    show_hits("Subscription evidence:", rec["subscription_hits"])
    print()

print("=" * 110)
print("Quick interpretation:")
print("- If a session or GLOBAL_CONFIG shows claude_code_key, managed key, API key, or API Usage Billing: it is API billing.")
print("- If it shows subscription/Pro/Max and no API key evidence: it may be subscription usage.")
print("- If local logs say UNKNOWN, run `claude --resume <session>` then `/status`; that is the authoritative local answer.")
