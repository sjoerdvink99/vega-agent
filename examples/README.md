# Examples

Real use cases, each built on the public API only.

| | Use case | Run |
|---|---|---|
| `explorer/` | a visual analytics tool in TypeScript with linked views | `npm install && npm run dev` |
| `node/` | a CI regression report for a model upgrade | `npm install && npm run report` |
| `web/` | the library in a plain page, no build step | serve the repository root, open `examples/web/` |
| `notebooks/` | the grammar, traces, a model upgrade, failure triage | `jupyter lab notebooks` |

Build the library first with `make install` from the repository root. The data in `data/` is synthetic and made by `data/generate.py`. `data/swe_agent.py` samples real SWE-agent trajectories from [nebius/SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC BY 4.0) into `docs/assets/swe-agent.jsonl`, an event log the gallery maps with `trace`.
