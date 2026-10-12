# 60-second showreel plan — relight

Master spec
- Duration: 60.000 s
- Frame rate: 24 fps progressive
- Total frames: 1440, numbered F0000-F1439
- Frame-to-time rule: frame F begins at F/24 seconds
- Delivery: 1920x1080, 16:9, Rec.709, stereo, H.264 MP4
- Safe area: keep essential text/logo within x=120-1800, y=90-990

Visual system (1920x1080, origin top-left)
- Base bg #1A1D24, panels #20242D, inset #14171D
- Main text #F3F5F7, secondary #A7AFBB, quiet #798390
- Teal accent #35D6C0, highlight #8AF0DF, dark teal #123F3B
- Success #67D89A
- Texture: 1-2% monochrome grain, soft radial teal bloom behind hero UI
- Type: Inter Medium/Semibold. Hero 76-90px, section 48-60px, caption 28-34px, UI 13-18px
- App window: x=150, y=126, w=1620, h=828, r=16, stroke #343B46 1px
- Title bar h=52, macOS dots at x=180/204/228, 12px
- Split canvas within window: x=184, y=202, w=1552, h=640
- Split handle: 2px teal line + 36px circular handle
- Easing: entrance cubic-bezier(0.22,1,0.36,1); camera cubic-bezier(0.65,0,0.35,1)

Continuity rule: identical mug/desk/props in every state. BEFORE = original photo; AFTER = cutout + new background + relight.

Scene list
S1 From flat to focused: F0000-F0143, 00:00-00:06, 6s. Problem: mug on wooden desk, needs better light.
S2 Open Relight: F0144-F0287, 00:06-00:12, 6s. Reveal dark studio app window.
S3 Four-step workflow: F0288-F0575, 00:12-00:24, 12s. Detect -> Matte -> Plan -> Assemble/Enhance.
S4 Control the studio: F0576-F0839, 00:24-00:35, 11s. macOS window, BEFORE/AFTER split, bg swatches.
S5 Relight the subject: F0840-F1079, 00:35-00:45, 10s. Light placement, fill, enhancement, "studio from browser".
S6 The result: F1080-F1271, 00:45-00:53, 8s. Hero before/after reveal.
S7 End card: F1272-F1439, 00:53-00:60, 7s. Wordmark, tagline, CTA.

Caption map (burn only if distribution requires; otherwise sidecar subs)
- F0048-F0071: "Good photo."
- F0120-F0143: "Needs better light."
- F0264-F0287: "Background removal, then studio relighting."
- F0288-F0311: "A clear path from cutout to final image."
- F0312-F0371: "Detect"
- F0372-F0431: "Matte"
- F0432-F0491: "Plan"
- F0492-F0551: "Assemble / Enhance"
- F0552-F0575: "Detect -> Matte -> Plan -> Assemble / Enhance."
- F0792-F0839: "Compare every change as you work."
- F0864-F0887: "Place the light."
- F0936-F0971: "Balance highlights and shadow."
- F1044-F1079: "A studio look, from your browser."
- F1152-F1199: "Same photo. A new sense of light."
- F1296-F1331: "Cut out. Shape the light. Make it yours."
- F1332-F1379: "Try Relight" (or "Explore Relight")

Caption behavior: lower-safe-zone, 30px Inter Medium white + soft dark backing/shadow, 6-frame fade in/out, never over mug handle or key detail.

Audio plan
Music: 60s instrumental electronic bed: warm analog pad, muted pluck pulse, brushed percussion, soft build, resolved final chord. No vocals. Spacious so SFX/captions feel premium.
Source: YouTube Audio Library (Music tab), search "ambient / minimal electronic / warm / technology". Save track name, artist, file, license + attribution.
Note: only YouTube Audio Library sounds are known to YouTube to be copyright-safe. Library includes tracks that require CC attribution and tracks whose standard license does not. Confirm per-track.
URL: https://support.google.com/youtube/answer/3376882?hl=en

SFX timing (frames / time / note)
- F0000-F0047 / 00:00-00:02: soft airy opening swell, low wide quiet, no transient
- F0072-F0119 / 00:03-00:05: contour-trace shimmer, high-freq, fade before next beat
- F0144-F0167 / 00:06-00:07: UI window settle, soft short whoosh
- F0240-F0263 / 00:10-00:11: button click, clean dry UI click
- F0312, F0372, F0432, F0492 / 00:13, 00:15.5, 00:18, 00:20.5: 4 UI pops, matched tone
- F0372-F0431 / 00:15.5-00:18: matte resolve, soft reveal shimmer
- F0648-F0719 / 00:27-00:30: split divider slide, quiet swish, no scrape
- F0720-F0743 / 00:30-00:31: background selection click
- F0888-F0935 / 00:37-00:39: light drag tonal sweep
- F0972-F1019 / 00:40.5-00:42.5: enhancement settle, subtle crystalline accent
- F1104-F1151 / 00:46-00:48: before/after reveal whoosh, broad soft
- F1272-F1295 / 00:53-00:54: end-card warm quiet chime
- F1332-F1379 / 00:55.5-00:57.5: CTA button pop, no bounce
- F1416-F1439 / 00:59-01:00: music tail fade to silence exactly at 60s

Mix: music -20 to -16 LUFS short-term under any voice; SFX a few dB above bed, never dominant. Headroom for headphones + laptop + mobile. No narration required by this plan.

Per-frame beats (keyframes only; in-betweens eased)
S1 F0000-F0143
- F0000: photo crop x=190-1730, y=92-988; subject ~(1040,555); mug ~31% frame height. No title/UI.
- F0000-F0047: slow 3% push-in; deepen shadows slightly, lower saturation a touch, keep wood grain/mug/film rolls visible.
- F0048-F0071: dark veil settles; "Good photo." fades in x=160,y=176 baseline, 62px semibold.
- F0072-F0119: photo pauses; slim teal line draws L->R under caption, then traces soft contour around mug (visual cue only, not a claimed selection method).
- F0120-F0143: caption -> "Needs better light."; contour glow gently intensifies.
- F0140-F0143: 4-frame teal-tinted luma dissolve to interface.

S2 F0144-F0287
- F0144-F0167: window scale 93%->100% centered (960,540); opacity 0->100%; bg -> #1A1D24.
- F0168-F0191: title bar + side panels settle. Top-left "Relight"; right tiny "Studio".
- F0192-F0239: photo slides into canvas x=330->960, ease to rest; side panels fade up.
- F0240-F0263: teal cursor to "Remove background" button, one click; button depression + teal ring. Do not claim unverified runtime.
- F0264-F0287: caption lower-left "Background removal, then studio relighting."; mug central in canvas.
- F0284-F0287: 4-frame slide of workflow strip into next scene.

S3 F0288-F0575
Workflow strip y=210-286; 4 cards 322x104 at x=184,570,956,1342; 16px gaps; each card: step number, short title, restrained icon. Active card: teal top rule + subtle glow.
- F0288-F0311: strip reveals; caption "A clear path from cutout to final image."
- F0312-F0371 Detect: card1 active; vertical scanning bar over image; thin teal edge on subject; "Detect"; subtitle "Find the subject."
- F0372-F0431 Matte: card2; checkerboard behind mug + film rolls; handle/rim edge resolves; "Matte"; subtitle "Refine the cutout."
- F0432-F0491 Plan: card3; two light-source glyphs arc into position; soft direction arrow; "Plan"; subtitle "Shape the light."
- F0492-F0551 Assemble/Enhance: card4; bg swatch slides in, then light layer; details settle; "Assemble / Enhance"; subtitle "Finish the image."
- F0552-F0575: all 4 cards visible; thin teal connector across row; caption "Detect -> Matte -> Plan -> Assemble / Enhance."
Motion: cards rise 12px while fading in, 12-frame stagger; active move 8 frames + 4-frame glow settle. No collisions/overshoot.
- F0572-F0575: 4-frame scale-through into main canvas.

S4 F0576-F0839
Window x=150,y=126,w=1620,h=828. Left rail x=170-350: Detect/Matte/Plan/Assemble. Canvas x=366,y=202,w=996,h=640. Right controls x=1380-1745,y=202-842: Background/Lighting/Enhance. Divider starts x=864,y=522.
- F0576-F0599: camera push 100%->104% toward canvas, settle.
- F0600-F0623: left rail + right controls fade in; legible labels.
- F0624-F0647: divider handle appears w/ teal ring; "BEFORE" top-left canvas, "AFTER" top-right.
- F0648-F0719: divider x=864->660, reveal cutout + new lighting on right; left = original desk photo; right = bg-removed mug on neutral studio ground.
- F0720-F0743: cursor to Background panel; 3 swatches: charcoal, warm sand, teal-gray; select warm sand.
- F0744-F0791: warm bg crossfade behind cutout; mug fixed scale/position; contact shadow fades in under it.
- F0792-F0839: hold split; caption "Compare every change as you work."; divider handle pulses once.
- F0836-F0839: 4-frame transition into scene 5.

S5 F0840-F1079
- F0840-F0863: camera pan right 110px, scale 106%; controls + mug visible.
- F0864-F0887: caption "Place the light."; light-source icon appears above right edge of mug.
- F0888-F0935: cursor drags light glyph (1510,430)->(1435,376); warm key travels right->left across mug; shadow direction changes in sync.
- F0936-F0971: second dimmer cool fill appears left; highlight rolloff smooth, not metallic/overexposed; caption "Balance highlights and shadow."
- F0972-F1019: one enhancement control 35%->52%; subtle detail enhancement on ceramic texture + film-roll edges. Only if this control exists in real app; otherwise render as visual concept.
- F1020-F1043: tap "Apply"/"commit" only if real action exists; otherwise animate committed state, do not invent button.
- F1044-F1079: camera eases back to 100%; hold finished studio image (lit mug + grounded shadow); caption "A studio look, from your browser."
- F1076-F1079: 4-frame into scene 6.

S6 F1080-F1271
- F1080-F1103: UI panels recede slightly; canvas grows x=190-1730,y=130-910; divider resets x=960.
- F1104-F1151: divider x=960->190 over 48 frames, reveal final image right->left; 2px teal line + circular handle.
- F1152-F1199: hold full after; mug centered ~(950,560), ~44% frame height; film rolls lower-right; warm neutral bg with gentle gradient; caption "Same photo. A new sense of light."
- F1200-F1235: output badge lower-right 240x44, bg #20242D, teal dot, 16px type: "READY TO EXPORT" only if real; else "FINAL LOOK".
- F1236-F1271: hold polished before/after; lower third fades; image uncluttered.
- F1268-F1271: 4-frame fade to dark end card.

S7 F1272-F1439
- F1272-F1295: Relight wordmark fade up center x=960,y=400; 74px semibold; simple teal aperture/light mark left.
- F1296-F1331: tagline below, 30px: "Cut out. Shape the light. Make it yours."
- F1332-F1379: CTA centered x=730,y=648,w=460,h=68,r=14, fill #35D6C0, text #10201E, 22px medium: "Try Relight" only if destination/product live; else "Explore Relight".
- F1380-F1415: CTA 2% scale settle; URL/domain below in 18px muted text if confirmed.
- F1416-F1439: hold steady; music resolves; final tail -> silence at 60.000s.

Assets to gather/create (all in video/assets/)
brand/: relight-wordmark.svg, relight-mark.svg (teal aperture/light mark)
ui/: icons/ (detect, matte, plan, assemble-enhance, light, background, cursor, etc., 1.5-2px stroke, rounded joins, teal accent), cursor.svg (pointer + click ring), workflow-cards/ (4 numbered cards)
stills/: mug_desk_before.tif (original high-res product photo: ceramic mug, wood desk, 2 film rolls, soft natural light; shoot/commission; keep lens/pose/props consistent; get releases), mug_cutout_alpha.png (transparent PNG/TIFF of same mug+props, refined handle/rim), mug_after_warm.png (composite on warm neutral studio bg, soft key upper-right, cool fill, contact shadow), mug_after_neutral.png (same on charcoal/gray)
backgrounds/: studio_bg_warm.png (#D8C6AA -> #B99D7E, in-house), studio_bg_charcoal.png (#454A50 -> #252A31, in-house), studio_bg_tealgray.png (#7D9A95 -> #384B4B, in-house)
textures/: grain_1080p.png (monochrome grain, in-house), teal_bloom.png (soft radial teal bloom, in-house)
fonts/: Inter/ (Google Fonts, open-source license per font; retain license file; URL https://developers.google.com/fonts)

Stock fallback: if a replacement photo is needed, search a stock library for mug+desk, verify current license + restrictions on identifiable people/trademarks/brands before use. Original photo preferred for before/after consistency + provenance.

Audio/: music/ (downloaded track + metadata), sfx/ (downloaded/created SFX), attribution/ (per-track license + credit text)

Field/meta files
- video/README.md: frame rate, resolution, color space, naming conventions, final export filename, how to regenerate.
- video/credits/asset_manifest.csv: every asset, source URL/file, license, attribution requirement, date acquired.
- video/credits/licenses/: copies of license files where applicable.
- video/credits/release_forms/: photographer/model/property/location releases for any real photo used.

Sources (licensing basis, not product-feature verification)
- YouTube Audio Library guidance: https://support.google.com/youtube/answer/3376882?hl=en
- Google Fonts licensing overview: https://developers.google.com/fonts
- SIL Open Font License: https://openfontlicense.org/

Open-source tools referenced for the actual app cutout (documented, not yet wired in)
- IMG.LY background removal: https://github.com/imgly/background-removal-js ; docs https://img.ly/docs/cesdk/js/edit-image/remove-bg-9dfcf7/ — packaged browser (WASM/WebGPU) + Node, ~40 MB first run, e-commerce/product oriented.
- RMBG-1.4 via Transformers.js: model https://huggingface.co/briaai/RMBG-1.4 ; runtime https://github.com/huggingface/transformers.js — browser WASM/WebGPU + Node, e-commerce/object in training; model card non-commercial, commercial use needs separate agreement with BRIA.
- rembg-web: https://github.com/bunn-io/rembg-web ; docs https://bunn-io.github.io/rembg-web/ — ONNX Runtime Web/WASM, tiny U2-Netp ~4.7 MB option plus larger models.

Verification checklist
1. Motion graphics + UI built to exact 1920x1080; keyframe ranges match frame map.
2. Each caption appears only on its frames; legible on large screen + mobile.
3. Before/after is the same source photo; subject size/position does not jump at split.
4. Every animated control corresponds to real relight functionality — or is clearly treated as illustrative UI, not a product promise.
5. Music + SFX license details, source, attribution kept with project.
6. Check color, shadow, grain, teal accents at full res; dark UI readable; mug retains natural highlights.
7. Export exactly 1440 frames; final frame F1439; duration ends 60.000s.
