# ImageGen Roadmap

## Phase 1: Creative Iteration Workspace

- Reference image upload: attach a local image as creative context, send it to the image edit/reference endpoint, and keep it with the generated version.
- Prompt enhancer: expand a short prompt into a more production-ready visual brief.
- Result versioning: keep the latest generation rounds as switchable versions in the current session, while saving compact records to local history.

## Phase 2: Point-Based Image Editing

Goal: explore a Lovart-inspired editing flow where the user clicks a point on an image instead of painting a mask or drawing a box.

Planned flow:

1. The user opens a generated image in edit mode.
2. The user drops one or more marker points on the image.
3. A vision model analyzes each marker coordinate with the image and returns the likely element or region, such as "left shoe", "table surface", "background window", or "product label".
4. The recognized element is inserted into the prompt composer as editable text.
5. The user writes a natural-language edit instruction against that element.
6. The edit request is sent to an image editing endpoint with the original image, marker metadata, and prompt.

Implementation notes:

- Keep this separate from the current generation route because it will need image input, coordinate metadata, and probably a different upstream endpoint.
- Store marker coordinates as normalized values from 0 to 1 so they survive responsive resizing.
- Start with single-point editing, then add multi-point grouping if the model response is stable.
- Preserve the existing generated versions so edits can become child versions rather than replacing the original result.
