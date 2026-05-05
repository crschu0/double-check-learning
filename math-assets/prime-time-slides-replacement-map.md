# Prime Time Slides Replacement Map

## Key Finding

The `Prime Time 1.1 slideshow (TPT)` deck is using several older Drive image IDs from the main `1.2` folder, not the newer high-quality files in:

`1.2 / remastered`

That means the blur is likely coming from old inserted images, not from Google Slides itself.

## Strong Replacement Candidates

| Current Slide Image Title Seen In Deck | Current Source ID | Better Replacement In `1.2/remastered` |
|---|---|---|
| `answer entrance ticket.png` | `1ey-ZNEvDhVApN4Qox49zBZwvRO0ZPaAf` | `entrance_ticket_answer_key_500dpi.png` |
| `answer 1.2.3.png` | `1iuOyKEZwCvgvMB4Jhl8KBgkGf9t4ggaA` | `1.2.3-answer.png` |
| `answer 1.2.4.png` | `1UeoUvWFMP1qXd_8ywTD4xb2b2kDcB8p8` | `1.2.4-answer.png` |
| `answer homework.png` | `1YKKPigF5hVDrnTxyauhIyarBB8zla2ZW` | `homework_answer_key_500dpi.png` |
| `answer homework advanced.png` | `1L6rjg0x5BrN9AQCriUGARobMBl79O88A` | `advanced_homework_answer_key_500dpi.png` |

## Tested In `Prime Time 1.1 test copy`

These four pages did not have native 500dpi replacements in the `remastered` folder, so I made faithful upscaled versions from the existing low-res originals. This keeps the original page design instead of redrawing it differently.

| Slide Image Title In Test Copy | Replacement File |
|---|---|
| `1.2 cover.png` | `math-assets/final-png/1.2-cover-upscaled-500dpi.png` |
| `1.2.1.png` | `math-assets/final-png/1.2.1-upscaled-500dpi.png` |
| `1.2.2.png` | `math-assets/final-png/1.2.2-upscaled-500dpi.png` |
| `1.2 answer cover.png` | `math-assets/final-png/1.2-answer-cover-upscaled-500dpi.png` |

## Crisp Replacements Tested In `Prime Time 1.1 test copy`

Slides 21-26 and 42-48 were replaced with sharpened 500dpi files to improve readability while preserving the original page design.

| Slide Numbers | Replacement Type |
|---|---|
| 21-26 | Sharpened student-facing 1.2 pages |
| 42-48 | Sharpened answer-key pages |

## Need A Matching 500 DPI Replacement

These current deck images appear to reference older assets, but the exact replacement was not confirmed from the `remastered` list yet:

| Current Slide Image Title Seen In Deck | Current Source ID | Note |
|---|---|---|
| `answer 1.2.2.png` | `1EfKXmQv7cAnnHNFNPtfstjfoL0D2weTP` | I did not find a 500 dpi answer 1.2.2 file in the current `remastered` folder inventory. |
| `answer exit ticket.png` | `10qAPraqPmNkSZHrrRtLxQR532nSyTPki` | I did not find a 500 dpi exit ticket answer replacement in `remastered`; there is an entrance ticket answer replacement. |

## Suggested Next Action

1. Make a copy of the Slides deck before replacements.
2. Replace the strong candidates first.
3. Compare the copied deck visually.
4. Only after verifying, move the old low-resolution Drive images into `archive-old-images`.
