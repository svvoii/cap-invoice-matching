# Agentic CAP: Invoice-to-PO Matching on SAP BTP Trial

A self-contained **Agentic SAP CAP (Node.js `@sap/cds` v10)** application that exposes a single domain model across three protocols: **OData V4**, **Model Context Protocol (MCP)**, and an **Agent2Agent (A2A)** assistant with **Human-in-the-Loop (`@agent.hitl`)** approval gates.

It is built as an independent, enhanced reproduction of the official SAP TechEd session:
> 🔗 **Original TechEd Lab:** [SAP-samples/teched2026-AD262 (*Agentic CAP: Build MCP Servers & Enterprise AI Agents*)](https://github.com/SAP-samples/teched2026-AD262)

---

## What It Does

The app implements an **Accounts Payable (AP)** invoice-matching workflow:
- **Semantic Vector Search:** Uses `@cap-js/ai` with in-process **ONNX Runtime (`all-MiniLM-L6-v2`)** on SQLite to match invoice descriptions to PO lines without remote vector DB or embedding API costs.
- **S/4HANA Master Data Integration:** Replicates S/4 supplier payment blocks (`sap.s4com.Supplier.v1`) into local CDS views to enforce compliance.
- **Declarative Policy via Markdown Skills:** AP policies (2% / 5% price-variance thresholds, blocked supplier escalation) are defined in plain Markdown (`AGENTS.md` + `SKILL.md`) without hardcoded JavaScript logic.
- **Human-in-the-Loop (`@agent.hitl`):** Exposes unbound actions over MCP so the agent proposes decisions autonomously, but pauses for human confirmation (`[Approve] / [Reject]`) before releasing funds.
- **Mistral Large Runtime:** Powered by **Mistral Large (`mistral-large-latest`)** via a clean outbound fetch sanitizer in `srv/server.js`.
- **Enterprise Governance:** Structured audit trails via `@PersonalData` (`@cap-js/audit-logging`) and trigger-based change history via `@changelog` (`@cap-js/change-tracking`).

---

## AI Developer Tooling & Agent Skills (`.agents`)

This project was developed locally in VS Code using agentic AI workflows. The repository includes:
- **`cap-developer` (`cap-dev`) skill:** Located in [`.agents/skills/cap-developer/`](.agents/skills/cap-developer/), installed from [capire/skills](https://github.com/capire/skills). It equips AI coding agents (Claude Code, Mistral Vibe, Antigravity) with authoritative CAP modeling best practices, CDS idioms, and runtime guidance directly from `cap.cloud.sap`.
- **`cap-mcp` plugin:** Configured in [`.agents/plugins/cap-mcp/`](.agents/plugins/cap-mcp/) to enable runtime schema inspection and live documentation search via MCP.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Deploy model and seed local SQLite database
npm run deploy

# 3. Start CAP server with mock S/4 services
npm run watch
```

- **Service Index:** `http://localhost:4004`
- **React Matching Workbench:** `http://localhost:4004/matching/dist/index.html`
- **A2A Agent Preview UI:** `http://localhost:4004/a2a/matching/preview/`

> **Note:** Node.js 22 LTS is recommended (see `.nvmrc`). For live LLM agent execution, create a local `.env` file with `MISTRAL_API_KEY=<your-key>`.

---

## Step-by-Step Reproduction Guide

To build, test, and deploy this complete setup from scratch on **SAP BTP Trial (Cloud Foundry)**, follow the comprehensive guide in:
📄 **[STEP-BY-STEP.md](./STEP-BY-STEP.md)**

It covers:
1. Environment setup and local CLI scaffolding.
2. Domain modeling, vector search, and React workbench.
3. Exposing MCP tools and configuring `@cap-js/agents` with Mistral Large.
4. Three critical engineering gotchas (bound vs. unbound actions, mandatory `AGENTS.md`, and Cloud Foundry ONNX staging memory limits).
5. Self-contained deployment to SAP BTP Trial (`cf push`).
