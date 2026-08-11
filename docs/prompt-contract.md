# 提示词契约（Prompt Contract）

> 用途：把本文件连同任务要求发给多模态模型，让模型的回复严格按下方格式返回，
> 前端「粘贴导入」即可整段粘贴、自动批量生成带标题与正确尺寸的提示词卡片。

## 一、任务目标

针对网店商品图生成任务，为每个产品输出一批提示词，供图生图（或文生图）模型生成营销图。要求：

1. 每批恰好 10 张卡片：轮播图 5 张（标题 `轮播图1`..`轮播图5`）+ 详情图 5 张（标题 `详情图1`..`详情图5`）
2. 轮播图比例 `1:1`（正方形），详情图比例 `9:16`（竖版长图）
3. 提示词为逗号分隔的关键词短语，2-4 句，面向电商商品摄影
4. **提示词语言由你根据产品信息判断，不要默认写死某一种**：中文产品（名称 / 包装文字 / 目标受众为中文）用中文提示词，英文产品（英文名 / 面向海外市场）用英文提示词；同批 10 张全部保持同一种语言，不中英混用
5. 10 张卡片的画面内容需互相区分（景别 / 角度 / 布景 / 光线有变化），避免雷同

## 二、输出格式（模型必须严格遵守）

回复正文必须恰好包含 **10 个块**，每个块结构如下，块与块之间空一行：

    === 标题 ===
    ```text
    ratio: 宽:高

    提示词正文（2-4 句，关键词短语，语言与产品一致：中文产品写中文、英文产品写英文；不要分点、不要编号）
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

    === 轮播图1 ===
    ```text
    ratio: 1:1

    product bottle on clean mint background, centered composition, studio lighting, soft shadow
    ```

    === 轮播图2 ===
    ```text
    ratio: 1:1

    close-up of bottle cap and texture, shallow depth of field, pastel tones, commercial product photo
    ```

    === 轮播图3 ===
    ```text
    ratio: 1:1

    bottle with water splash, high contrast, dynamic hero shot, advertising style
    ```

    === 轮播图4 ===
    ```text
    ratio: 1:1

    bottle on marble surface, top-down view, minimalist composition, elegant product display
    ```

    === 轮播图5 ===
    ```text
    ratio: 1:1

    bottle with brand logo facing camera, golden hour light, warm background, product focus
    ```

    === 详情图1 ===
    ```text
    ratio: 9:16

    vertical poster, full product shot, brand name at top, clean gradient background, e-commerce banner
    ```

    === 详情图2 ===
    ```text
    ratio: 9:16

    info card layout, product name and net weight text, soft card background, vertical banner
    ```

    === 详情图3 ===
    ```text
    ratio: 9:16

    bottle in bathroom scene, tiled wall background, towel nearby, lifestyle vertical shot
    ```

    === 详情图4 ===
    ```text
    ratio: 9:16

    hand pressing pump dispenser, cropped below neck, skincare action shot, vertical composition
    ```

    === 详情图5 ===
    ```text
    ratio: 9:16

    closing shot, bottle centered with brand slogan, clean studio background, vertical banner
    ```

（其余轮播图/详情图按上面规则与画面差异化要求填写。）

### 语言对照示例（同一产品的中文写法，格式与上面完全一致）

    === 轮播图1 ===
    ```text
    ratio: 1:1

    产品瓶身居中构图，清新薄荷色背景，棚拍打光，柔和阴影，电商主图风格
    ```

    === 详情图1 ===
    ```text
    ratio: 9:16

    竖版海报，产品全身展示，顶部放品牌名，干净渐变背景，电商详情页横幅
    ```

中文产品请仿照此写法输出中文关键词短语；英文产品沿用上方英文示例的风格。
两种语言都合规，关键是与产品保持一致。

## 四、比例与尺寸映射

前端按块内 `ratio: 宽:高` 匹配系统配置的尺寸（不写死分辨率，以系统实际配置为准）：

| 比例 | 用途 | 说明 |
| :--- | :--- | :--- |
| 1:1 | 轮播图 | 正方形 |
| 9:16 | 详情图 | 竖版长图 |

若回复中的比例不在系统配置里，前端会回退到默认尺寸，并在导入界面提示「尺寸回退」，可手动调整。

## 五、提示词内容规范

- 主体明确：先写产品主体（瓶身 / 盖子 / 泵头等），再写场景、光线、构图
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

## 七、合规文字要求

- 文案（品牌名、产品名、标语）如需出现在画面中，使用占位符并在附注中说明
- 不虚构资质、功效、专利等未经确认的信息
- 涉及人物皮肤、药妆功效的画面，不夸大描述，避免绝对化用语（「最」「百分百」等）
