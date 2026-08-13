# Static Toolbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-deployable static web toolbox that combines the four browser-only image tools and lets a current image move between them without uploading it.

**Architecture:** Create a separate Vite + React + TypeScript application in `C:\Users\11965\Desktop\生图\toolbox-web` so the existing Imagora frontend remains unchanged. A shared in-memory image session holds the selected file and uses hash navigation; each tool component works locally in the browser and exposes its latest result to the session.

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Testing Library, Canvas API, JSZip, lucide-react.

---

### Task 1: Create isolated web application foundation

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\package.json`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\vite.config.ts`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\tsconfig.json`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\main.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\App.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\app.test.tsx`

- [ ] **Step 1: Write the failing navigation test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("opens the watermark tool from the toolbox navigation", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "批量加水印" }).then((button) => button.click());
    expect(screen.getByRole("heading", { name: "批量加水印" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/app.test.tsx`

Expected: FAIL because `App.tsx` does not exist.

- [ ] **Step 3: Implement the app shell and hash navigation**

```tsx
export type ToolId = "home" | "watermark" | "compress" | "white-bg" | "frame";

export const tools = [
  { id: "watermark", name: "批量加水印" },
  { id: "compress", name: "图片压缩" },
  { id: "white-bg", name: "批量白底" },
  { id: "frame", name: "商品边框" },
] as const;

export default function App() {
  const [tool, setTool] = useState<ToolId>("home");
  return <main>{tool === "home" ? <Home onOpen={setTool} /> : <ToolPage tool={tool} />}</main>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/app.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the foundation**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add .
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: create static toolbox shell"
```

### Task 2: Add shared browser-only image session

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\imageSession.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\imageSession.test.tsx`
- Modify: `C:\Users\11965\Desktop\生图\toolbox-web\src\App.tsx`

- [ ] **Step 1: Write the failing session test**

```tsx
it("keeps the image available after changing tools", () => {
  const file = new File(["image"], "product.png", { type: "image/png" });
  const { result } = renderHook(() => useImageSession(), { wrapper: ImageSessionProvider });
  act(() => result.current.setCurrentImage(file));
  expect(result.current.currentImage?.name).toBe("product.png");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/imageSession.test.tsx`

Expected: FAIL because `ImageSessionProvider` and `useImageSession` do not exist.

- [ ] **Step 3: Implement an in-memory React context**

```tsx
type ImageSessionValue = {
  currentImage: File | null;
  setCurrentImage: (file: File | null) => void;
};

const ImageSessionContext = createContext<ImageSessionValue | null>(null);

export function ImageSessionProvider({ children }: PropsWithChildren) {
  const [currentImage, setCurrentImage] = useState<File | null>(null);
  return <ImageSessionContext.Provider value={{ currentImage, setCurrentImage }}>{children}</ImageSessionContext.Provider>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/imageSession.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the shared image session**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add src
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: share current image between tools"
```

### Task 3: Build reusable tool page layout and transfer actions

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\components\ToolLayout.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\components\ToolLayout.test.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\styles.css`
- Modify: `C:\Users\11965\Desktop\生图\toolbox-web\src\App.tsx`

- [ ] **Step 1: Write the failing transfer action test**

```tsx
it("offers another tool when a current image exists", () => {
  render(<ToolLayout title="图片压缩" currentImage={new File(["x"], "a.png")} onNavigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "发送到加水印" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/ToolLayout.test.tsx`

Expected: FAIL because `ToolLayout.tsx` does not exist.

- [ ] **Step 3: Implement a responsive shell**

```tsx
{currentImage && (
  <nav aria-label="图片流转">
    {otherTools.map((tool) => (
      <button key={tool.id} onClick={() => onNavigate(tool.id)}>发送到{tool.name.replace("批量", "")}</button>
    ))}
  </nav>
)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/ToolLayout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the reusable layout**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add src
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: add tool layout and transfer actions"
```

### Task 4: Implement browser image utilities and compression

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\lib\image.ts`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\lib\image.test.ts`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\CompressionTool.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\CompressionTool.test.tsx`

- [ ] **Step 1: Write a failing file validation test**

```ts
it("accepts a PNG image", () => {
  expect(isSupportedImage(new File(["x"], "a.png", { type: "image/png" }))).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/image.test.ts`

Expected: FAIL because `isSupportedImage` does not exist.

- [ ] **Step 3: Implement file validation and Canvas JPEG compression**

```ts
export function isSupportedImage(file: File) {
  return file.type.startsWith("image/");
}

export async function compressImage(file: File, quality: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: blob.type });
}
```

- [ ] **Step 4: Write and run the compression tool test**

Run: `npm test -- src/tools/CompressionTool.test.tsx`

Expected: FAIL before component implementation; PASS after it renders an upload control and a download action following a valid image.

- [ ] **Step 5: Commit compression**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add src
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: add local image compression"
```

### Task 5: Implement watermark, white background, and frame tools

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\WatermarkTool.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\WhiteBackgroundTool.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\FrameTool.tsx`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\src\tools\tools.test.tsx`
- Modify: `C:\Users\11965\Desktop\生图\toolbox-web\src\App.tsx`

- [ ] **Step 1: Write failing rendering tests**

```tsx
it.each([
  ["批量加水印", WatermarkTool],
  ["批量白底", WhiteBackgroundTool],
  ["商品边框", FrameTool],
])("renders %s upload control", (_, Tool) => {
  render(<Tool />);
  expect(screen.getByLabelText("上传图片")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/tools/tools.test.tsx`

Expected: FAIL because the tool components do not exist.

- [ ] **Step 3: Port only the browser-local algorithms**

```tsx
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
context?.drawImage(image, 0, 0);
context?.fillText(watermarkText, x, y);
```

Use Canvas API for text/image watermarking and white background compositing. Extract the product frame SVG asset from the current standalone file into a dedicated static asset and render it into Canvas at export time.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/tools/tools.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the three tools**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add src public
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: add local image editing tools"
```

### Task 6: Integrate all tools and verify the static build

**Files:**
- Modify: `C:\Users\11965\Desktop\生图\toolbox-web\src\App.tsx`
- Modify: `C:\Users\11965\Desktop\生图\toolbox-web\src\styles.css`
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\README.md`

- [ ] **Step 1: Write the failing cross-tool integration test**

```tsx
it("keeps an uploaded image when the user changes from compression to watermark", async () => {
  render(<App />);
  await userEvent.upload(screen.getByLabelText("上传图片"), new File(["x"], "product.png", { type: "image/png" }));
  await userEvent.click(screen.getByRole("button", { name: "发送到加水印" }));
  expect(screen.getByText("已带入 product.png")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/app.test.tsx`

Expected: FAIL until the tool props are wired to `ImageSessionProvider`.

- [ ] **Step 3: Wire tools to the shared image session and create the README**

```tsx
<ImageSessionProvider>
  <App />
</ImageSessionProvider>
```

Document `npm install`, `npm run dev`, `npm run build`, the privacy guarantee, and Vercel import settings: framework Vite, build command `npm run build`, output directory `dist`.

- [ ] **Step 4: Run the complete verification set**

Run: `npm test && npm run build && npm run lint`

Expected: all tests pass, TypeScript compilation passes, and Vite writes `dist`.

- [ ] **Step 5: Commit the integrated toolbox**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web add .
git -C C:\Users\11965\Desktop\生图\toolbox-web commit -m "feat: complete static image toolbox"
```

### Task 7: Publish through GitHub and Vercel

**Files:**
- Create: `C:\Users\11965\Desktop\生图\toolbox-web\vercel.json`

- [ ] **Step 1: Add a no-rewrite Vercel configuration**

```json
{
  "framework": "vite"
}
```

- [ ] **Step 2: Verify the production preview**

Run: `npm run build && npm run preview -- --host 127.0.0.1`

Expected: the hash URLs `/#/watermark`, `/#/compress`, `/#/white-bg`, and `/#/frame` all render after direct refresh.

- [ ] **Step 3: Create or use the GitHub repository and push**

```powershell
git -C C:\Users\11965\Desktop\生图\toolbox-web remote add origin <new-github-repository-url>
git -C C:\Users\11965\Desktop\生图\toolbox-web push -u origin main
```

- [ ] **Step 4: Import the repository into Vercel and bind the domain**

In Vercel, import the GitHub repository, accept the Vite defaults, deploy, then add `toolboxonline.online` and `www.toolboxonline.online` only after the user confirms replacement of the currently live website.

- [ ] **Step 5: Verify public deployment**

Open the production domain, test one upload-to-download action, and confirm no network request sends image data to an application API.
