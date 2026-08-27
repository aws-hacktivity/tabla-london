# sentiment-tag

Tag short sentences with a sentiment face (🙂, 😐, or 🙁) using a
rule-based keyword scorer with negation awareness. No machine learning.

## How it works

You type a short sentence. The scorer tokenizes it, looks up each word
against three word lists (positive, negative, neutral), handles negation
("not good" → negative), and sums up a score. The sign of the score picks
the face.

## Requirements (EARS style)

### Scoring

- WHEN the scorer receives a sentence, THE SYSTEM SHALL tokenize into
  whole words, score each against word lists with negation awareness, and
  return a face based on the sign of the total.
- Score > 0 → 🙂, = 0 → 😐, < 0 → 🙁.
- Matching is whole-word, case-insensitive.

### Negation

- WHEN a negation word (not, don't, never, can't, etc.) precedes a
  sentiment word, THE SYSTEM SHALL flip that word's polarity.
- The negation window is exactly 1 token.

### API

- POST `/api/sentiment-tag` with `{session, text}` → 201 + `{face, score, text, at}`
- GET `/api/sentiment-tag?session=<id>` → array of entries, newest first
- text must be 1–280 characters; empty or oversized → 400

### Storage

- Results stored persistently; each submission is a new entry.
- pk: `SESSION#<sessionId>`, sk: `SENTIMENT#<timestamp>#<callerId>#<uid>`

## Word lists

### Positive (50 words)

good, great, love, happy, excellent, amazing, awesome, fantastic,
wonderful, enjoy, helpful, fun, easy, smooth, clear, fast, nice, like,
pleased, confident, brilliant, perfect, beautiful, exciting, impressive,
outstanding, superb, terrific, delightful, glad, cheerful, satisfied,
thrilled, grateful, blessed, inspired, motivated, productive,
comfortable, friendly, supportive, creative, elegant, refreshing,
rewarding, successful, joyful, peaceful, bright, warm

### Negative (50 words)

bad, terrible, hate, awful, slow, confusing, hard, frustrating,
annoying, boring, ugly, broken, wrong, stuck, painful, difficult, lost,
worst, fail, useless, horrible, dreadful, disappointing, exhausting,
miserable, stressful, overwhelming, clunky, tedious, irritating, lousy,
weak, poor, messy, complicated, unclear, buggy, laggy, crashing, frozen,
bloated, chaotic, draining, hopeless, nightmare, rough, tiresome,
wasteful, unfair, depressing

### Neutral (20 words)

okay, fine, alright, meh, whatever, so-so, average, normal, moderate,
fair, decent, passable, adequate, mediocre, standard, typical, regular,
ordinary, acceptable, unremarkable

### Negation words (21)

not, no, don't, doesn't, isn't, aren't, wasn't, weren't, won't, can't,
couldn't, shouldn't, wouldn't, never, neither, nobody, nothing, nowhere,
hardly, barely, scarcely

## Negation rules

| Input | Score | Face | Why |
|-------|-------|------|-----|
| "good" | +1 | 🙂 | positive word |
| "not good" | −1 | 🙁 | negation flips positive → negative |
| "not bad" | +1 | 🙂 | negation flips negative → positive |
| "not very good" | +1 | 🙂 | "not" consumed by "very" (not sentiment), "good" un-negated |
| "good and bad" | 0 | 😐 | +1 −1 cancel out |

## Store key convention

| pk | sk | item fields |
|----|----|----|
| `SESSION#<sessionId>` | `SENTIMENT#<ISO-ts>#<callerId>#<uid>` | face, score, text, callerId, at |

## Known limitations

| Limitation | Example | Why |
|---|---|---|
| Negation window is 1 word | "I do not think this is good" → only "think" is negated | No grammar parser |
| Sarcasm undetected | "oh great, another meeting" → +1 | No tone model |
| Unknown words neutral | "meh" unless in list → 0 | Closed vocabulary |
| Compound words miss | "goodness" ≠ "good" | Whole-word boundary |

## API examples

```bash
# Submit a sentiment
curl -X POST http://localhost:3000/api/sentiment-tag \
  -H 'Content-Type: application/json' \
  -d '{"session":"room-1","text":"this workshop is great"}'
# → {"face":"🙂","score":1,"text":"this workshop is great","at":"..."}

# Get all entries for a session
curl http://localhost:3000/api/sentiment-tag?session=room-1
# → [{"face":"🙂","score":1,"text":"...","callerId":"...","at":"..."}, ...]
```
