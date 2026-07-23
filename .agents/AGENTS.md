# Design Standards

## UI Concentric Rounded Corners (R 角比例)
When designing nested UI elements with border-radius (R角), always maintain a consistent concentric proportion to ensure a proper "wrapping" effect (包裹感).
Use the standard formula: 
**Inner Border Radius = Outer Border Radius - Padding**

If the padding varies, use the smaller padding value or the most visually dominant axis. 
For example, if an outer container has a 24px border radius (`var(--radius-large)`) and a padding of 16px, the inner elements should have a border radius of 8px (`var(--radius-small)`) to maintain perfect curvature alignment.
Avoid arbitrarily mixing large border radii on inner blocks with small padding, as it creates mismatched curvatures that look uncoordinated.

## CI/CD Gatekeeper Check
Whenever you make any code modifications, you MUST run the gatekeeper check (`npm run check`) to ensure no tests or builds are broken. Do NOT consider your work finished until this check passes.
