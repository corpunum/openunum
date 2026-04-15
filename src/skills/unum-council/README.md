# UnumCouncil Skill

## Purpose
Summon a council of the 5 strongest available models (Ollama + NVIDIA only) to debate complex requests. The default/strongest model consolidates responses, then the council votes on each action/claim. Only voted-approved items remain in the final output.

## Triggers
- User explicitly requests: "use UnumCouncil", "council vote", "summon council"
- Request complexity exceeds threshold (multi-step, high-risk, architectural decisions)

## Workflow
1. **Model Selection**: Pick up to 5 strongest candidates from `ollama-cloud` and `nvidia`
2. **Request Distribution**: Send the same request to each council member
3. **Response Collection**: Parse each member into `summary`, `claims`, `actions`, `risks`, `confidence`
4. **Consolidation**: Aggregate repeated claims/actions deterministically
5. **Voting Phase**: Keep only items that meet the approval threshold
6. **Final Output**: Return approved claims/actions plus dissenting risks

## Files
- `index.mjs` — Main skill logic
- `council-config.json` — Model selection rules
- `voting-rules.md` — Voting threshold documentation

## Usage
```javascript
skill_execute({ name: 'unum-council', args: { request: '...', threshold: 0.6 } })
skill_execute({ name: 'unum-council', args: { request: '...', dryRun: true } })
```
