# Imagora Image Interaction And Connection Design

## Goal

Improve image-node interaction and connection feedback without changing the canvas workflow model.

## Interaction Design

- Double-clicking the image preview opens the existing large-image preview modal.
- Hovering an image node reveals a compact vertical action rail on the image's right side.
- The action rail contains preview, replace, and delete icon buttons in that order.
- Buttons remain `nodrag` controls so clicking them never moves the node.
- Each icon button has an accessible label and hover tooltip.

## Connection Design

- Top and bottom handles use fixed canvas dimensions so React Flow's measured geometry remains stable across zoom levels.
- Handles keep React Flow's standard centered translate transforms and do not use inverse scaling.
- The temporary connection path uses `var(--color-brand)`, which already changes with the current window theme.
- Valid target highlighting continues to use the same window theme color.

## Scope

- Reuse the existing `ZoomModal` and `handleZoom` state flow.
- Keep the existing image-node data model and connection rules unchanged.
- Do not change prompt-node or group-node action placement.

## Verification

- Double-clicking an image opens the correct preview and closing it restores the canvas.
- Preview, replace, and delete controls appear to the image's right and remain clickable.
- At minimum, verify connection endpoints at fitted zoom, 100%, and 200%; each edge must meet the matching handle's outer edge without visible offset.
- Verify the temporary connection path color equals the active window brand color.
- Run the complete frontend tests and production build.
