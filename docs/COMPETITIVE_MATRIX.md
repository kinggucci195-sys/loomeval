# LoomEval: Competitive Matrix

This document provides a feature-by-feature competitive audit of 15 major AI evaluation and observability platforms against the requirements of browser-agent testing.

---

## 1. Feature Comparison Matrix

| Platform | Production Tracing | Browser Tracing | DOM Capture | Screenshot Capture | Network Fixture | Tool Eval | Trajectory Eval | Failure Cluster | Trace-to-Test | Local Replay | Browser Replay | Counterfactual Evals | CI Gating | Self-Host | SDK / Proxy | Primary Buyer | Pricing Model | Strongest Advantage | Weakest Area | Evidence Source |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **LangSmith** | Yes | No | No | Partial | No | Yes | Yes | No | Yes | No | No | No | Yes | No | SDK | AI Engineer | Pay-as-you-go | LangChain native | No browser capture | [LangSmith Docs](https://docs.smith.langchain.com) |
| **Langfuse** | Yes | No | No | No | No | Yes | Yes | No | No | No | No | No | Yes | Yes | SDK | LLM Engineer | Free / Cloud | Open Source (MIT) | Lacks visual logs | [Langfuse Docs](https://docs.langfuse.com) |
| **Braintrust** | Yes | No | No | No | No | Yes | Yes | No | Yes | No | No | No | Yes | No | SDK | AI Lead | Volume-based | Fast eval speeds | No browser runtime | [Braintrust Docs](https://www.braintrust.dev/docs) |
| **Arize Phoenix** | Yes | No | No | No | No | Yes | Yes | Yes | No | No | No | No | Yes | Yes | OTel SDK | ML Engineer | Free / Enterprise | OpenTelemetry native | Complex setup | [Phoenix Docs](https://docs.arize.com/phoenix) |
| **W&B Weave** | Yes | No | No | No | No | Yes | Yes | No | No | No | No | No | Yes | No | SDK | ML Scientist | Enterprise seat | ML lineage | Not agent-centric | [Weave Docs](https://wandb.github.io/weave) |
| **Galileo** | Yes | No | No | No | No | Yes | Yes | Yes | No | No | No | No | Yes | No | SDK | AI Platform Team | Custom Enterprise | Hallucination EFMs | No browser support | [Galileo Docs](https://docs.rungalileo.io) |
| **Patronus AI** | Yes | No | No | No | No | Yes | Yes | No | Yes | No | No | No | Yes | No | SDK / API | Compliance Lead | Enterprise | Security Red-teaming | No dev debugging | [Patronus Docs](https://docs.patronus.ai) |
| **DeepEval** | Yes | No | No | No | No | Yes | Yes | No | Yes | No | No | No | Yes | Yes | Python SDK | SDET | Open Source / Cloud | Pytest integration | Slow LLM-judge evals| [DeepEval Docs](https://docs.confident-ai.com) |
| **Promptfoo** | Yes | No | No | No | No | Yes | No | No | Yes | Yes | No | Yes | Yes | Yes | CLI / SDK | Dev / SecOps | Free / Cloud | Fast CLI red-teaming | Basic UI / No graph | [Promptfoo Docs](https://www.promptfoo.dev/docs) |
| **AgentOps** | Yes | Partial | No | Yes | No | Yes | Yes | Yes | No | No | No | No | Yes | No | SDK | Agent Dev | Free / Tiered | Session replays | No sandboxed replays | [AgentOps Docs](https://docs.agentops.ai) |
| **Maxim AI** | Yes | No | No | No | No | Yes | Yes | No | Yes | No | No | No | Yes | No | SDK | Product Team | Tiered | User persona sim | Lacks browser mocks | [Maxim Docs](https://docs.maximai.com) |
| **Parea AI** | Yes | No | No | No | No | Yes | Yes | No | No | No | No | No | Yes | No | SDK | AI Dev | Volume-based | Human-in-loop evals | No sandbox execution | [Parea Docs](https://docs.parea.ai) |
| **HoneyHive** | Yes | No | No | No | No | Yes | Yes | No | Yes | No | No | No | Yes | No | SDK | Product Manager | Tiered | Production feedback | Weak agent debugging | [HoneyHive Docs](https://docs.honeyhive.ai) |
| **Portkey** | Yes | No | No | No | No | Basic | No | No | No | No | No | No | No | No | Gateway API | Platform Lead | Volume-based | LLM Gateway proxy | No testing runner | [Portkey Docs](https://docs.portkey.ai) |
| **TruLens** | Yes | No | No | No | No | Yes | Yes | No | No | No | No | No | Yes | Yes | Python SDK | ML Researcher | Free / Open Source | RAG Triad standard | Text-heavy CLI focus | [TruLens Docs](https://www.trulens.org) |

---

## 2. Core Strategic Gaps
1.  **Zero Browser Replay Infrastructure**: Not a single major competitor executes or mocks browser environments natively. While AgentOps lets developers upload screenshots, it is a static display. No platform replays the network exchanges or DOM states locally to fix a failing web-interaction locator.
2.  **No Automated Mock-Based Testing**: Existing tools require developers to execute live model calls and live network calls during evaluation runs, incurring massive costs and introducing flakiness. None capture the production API requests and automatically mock them for $0 local execution.
