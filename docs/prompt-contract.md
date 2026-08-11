# 提示词契约（Prompt Contract）

> 用途：把本文件连同任务要求发给多模态模型，让模型的回复严格按下方格式返回，
> 前端「粘贴导入」即可整段粘贴、自动批量生成带标题与正确尺寸的提示词卡片。

## 一、任务目标

针对网店商品图生成任务，为每个产品输出一批提示词，供图生图（或文生图）模型生成营销图。要求：

1. 每批恰好 10 张卡片：轮播图 5 张（标题 `轮播图1`..`轮播图5`）+ 详情图 5 张（标题 `详情图1`..`详情图5`）
2. 轮播图比例 `1:1`（正方形），详情图比例 `9:16`（竖版长图）
3. 提示词为逗号分隔的关键词短语，**要点尽量多、尽量细，不要惜字如金**——把画面里能看到的细节（主体、材质、颜色、场景、光线、构图、氛围、镜头等）尽量都写进去，面向电商商品摄影
4. **提示词语言由你根据产品信息判断，不要默认写死某一种**：中文产品（名称 / 包装文字 / 目标受众为中文）用中文提示词，英文产品（英文名 / 面向海外市场）用英文提示词；同批 10 张全部保持同一种语言，不中英混用
5. 10 张卡片的画面内容需互相区分（景别 / 角度 / 布景 / 光线有变化），避免雷同
6. **忠实于参考图，不臆造**：只描述参考图里看得到 / 用户明确提供的信息；瓶内液体颜色、未展示的角度、材质、成分等没给的内容一律不要猜测编造，不确定就省略或用占位符（如「液体颜色按参考图」）

## 二、输出格式（模型必须严格遵守）

回复正文必须恰好包含 **10 个块**，每个块结构如下，块与块之间空一行：

    === 标题 ===
    ```text
    ratio: 宽:高

    提示词正文（关键词短语，**点越多越好、越细越好**，语言与产品一致：中文产品写中文、英文产品写英文；把已知产品信息写足写细，不要分点、不要编号）
    ```

规则：

- 每块第一行必须是 `=== 标题 ===`（标题简短，如「轮播图1」「详情图3」），不含其它符号
- 围栏必须使用 ```text（或 ```）且独占一行
- 围栏内第一行必须是 `ratio: 宽:高`，宽高用英文冒号分隔（如 `ratio: 1:1`）
- 正文放在 ratio 行之后，可多行；不要用 markdown 列表、加粗、编号
- 10 个块 = 轮播图 1:1 五张（标题轮播图1..5）+ 详情图 9:16 五张（标题详情图1..5）
- 不要在 10 个块之外再输出任何解释文字；如需补充说明，放在最后单独一段并以「附注：」开头

## 三、完整示例

> 以下示例提示词用英文书写，**仅为演示格式与画面差异化，不代表默认语言**。
> 实际输出语言须按产品判断（见「任务目标」第 4 条）：中文产品写中文提示词，示例见文末「语言对照示例」。
> **示例每块只写到一部分，末尾省略号（...）表示实际输出还应继续写更多点**；
> 实际输出的要点应明显多于示例，但**不要真的输出省略号**，要把所有要点写全。

    === 轮播图1 ===
    ```text
    ratio: 1:1

    product bottle on clean mint background, centered composition, studio lighting, soft shadow, glossy cap visible, front label facing camera, label colors matching mint theme, subtle reflection under bottle, fresh and minimal e-commerce hero shot, crisp focus on product, ...
    ```

    === 轮播图2 ===
    ```text
    ratio: 1:1

    close-up of bottle cap and neck, visible ridges on cap, condensation droplets on surface, shallow depth of field, pastel tones, blurred background, cap texture detail, light reflections on glass, commercial product photo, ...
    ```

    === 轮播图3 ===
    ```text
    ratio: 1:1

    bottle surrounded by dynamic water splash, motion frozen mid-air, high contrast lighting, dark background, hero advertising style, product stands out sharply, droplets sparkling, energetic composition, bold visual impact, ...
    ```

    === 轮播图4 ===
    ```text
    ratio: 1:1

    bottle on marble surface, top-down view, minimalist composition, soft natural light, subtle reflection on marble, elegant premium product display, clean negative space, muted color palette, high-end feel, ...
    ```

    === 轮播图5 ===
    ```text
    ratio: 1:1

    bottle with brand logo facing camera, golden hour warm light, gentle rim light on edges, warm background, product focus, inviting lifestyle feel, soft bokeh in background, cozy atmosphere, eye-catching composition, ...
    ```

    === 详情图1 ===
    ```text
    ratio: 9:16

    vertical poster, full product shot centered, brand name placeholder at top, clean gradient background, product occupies lower half, ample negative space for text, soft shadow under product, e-commerce banner, modern typography layout, ...
    ```

    === 详情图2 ===
    ```text
    ratio: 9:16

    info card layout, product thumbnail on left, text areas on right, product name and net weight placeholder text, soft card background, clean modern layout, subtle dividers, vertical banner, easy-to-read arrangement, ...
    ```

    === 详情图3 ===
    ```text
    ratio: 9:16

    bottle in bathroom scene, tiled wall background, towel nearby, warm ambient light, shallow depth of field, product integrated naturally in scene, lifestyle vertical shot, cozy bathroom atmosphere, plants as decor, ...
    ```

    === 详情图4 ===
    ```text
    ratio: 9:16

    hand pressing pump dispenser, cropped below neck, visible product texture, soft natural skin tones, gentle motion, skincare action shot, vertical composition, clean background, focus on pump and product, ...
    ```

    === 详情图5 ===
    ```text
    ratio: 9:16

    closing shot, bottle centered with brand slogan placeholder, symmetrical composition, soft shadow under product, clean studio background, premium finish, vertical banner, elegant minimal style, product as visual anchor, ...
    ```

（其余轮播图/详情图按上面规则与画面差异化要求填写。）

### 语言对照示例（同一产品的中文写法，格式与上面完全一致）

    === 轮播图1 ===
    ```text
    ratio: 1:1

    产品瓶身居中构图，清新薄荷色背景，棚拍打光，柔和阴影，瓶盖细节清晰可见，正面标签朝向镜头，标签配色与薄荷主题呼应，瓶底轻微反光，简洁电商主图风格，焦点锐利，...
    ```

    === 详情图1 ===
    ```text
    ratio: 9:16

    竖版海报，产品全身展示居中，顶部预留品牌名占位，干净渐变背景，产品占据下半部分，留白充足便于排版文字，产品下方柔和阴影，现代排版布局，电商详情页横幅，...
    ```

中文产品请仿照此写法输出中文关键词短语；英文产品沿用上方英文示例的风格。
两种语言都合规，关键是与产品保持一致。示例中的省略号仅为示意，实际输出不要省略号、要点要更多更全。

## 四、比例与尺寸映射

前端按块内 `ratio: 宽:高` 匹配系统配置的尺寸（不写死分辨率，以系统实际配置为准）：

| 比例 | 用途 | 说明 |
| :--- | :--- | :--- |
| 1:1 | 轮播图 | 正方形 |
| 9:16 | 详情图 | 竖版长图 |

若回复中的比例不在系统配置里，前端会回退到默认尺寸，并在导入界面提示「尺寸回退」，可手动调整。

## 五、提示词内容规范

- 主体明确：先写产品主体（瓶身 / 盖子 / 泵头等），再写场景、光线、构图
- 详细度：要点尽量多、尽量细，把已知产品信息写全，宁多勿少；按实际画面和产品情况自行展开，不要机械套固定模板
- 语言跟随产品：中文产品用中文关键词短语，英文产品用英文关键词短语（判断规则见「任务目标」第 4 条）；同一张卡片内保持单一语言，不中英混用
- 关键词用逗号分隔，避免长句
- 不出现与产品无关的元素（人物脸部特写、手部遮挡主体等需按需求决定）
- 每张卡片描述的画面是独立成图的，不要写「同上一张」

## 六、禁止项

- 不要在块外写解释、前言、结论
- 不要用 markdown 标题（`#`）、列表、表格、加粗
- 不要少块（必须 10 个）或改变标题命名（轮播图N / 详情图N）
- 不要省略 `ratio:` 行或围栏
- 不要在同一标题下塞多个画面
- **不要臆造参考图没有的信息**（液体颜色、未展示的背面/角度、材质、成分等）——没给就不写，或用占位符（见「任务目标」第 6 条）
- **不要输出省略号**（示例中的 ... 仅为示意，实际要把所有要点写全）

## 七、合规文字要求

- 文案（品牌名、产品名、标语）如需出现在画面中，使用占位符并在附注中说明
- 不虚构资质、功效、专利等未经确认的信息
- 涉及人物皮肤、药妆功效的画面，不夸大描述，避免绝对化用语（「最」「百分百」等）
