# AI Creative Studio

AI驱动的创意内容生成平台，支持UGC视频自动化生成。

## ✨ 核心功能

### 🎬 UGC视频生成器

从产品图片自动生成高质量UGC视频，支持两种模式：

- **模式A（推荐）**：从产品图片直接生成创意UGC视频
- **模式B（高级）**：从爆款视频复制风格，批量生成新产品视频

**特点：**

- 🤖 AI自动分析产品并生成脚本
- 🎨 智能分镜头设计
- 🎥 使用Google Veo 3.1生成专业视频
- ⚡ 10-15分钟完成16秒视频
- 💰 成本约$2/视频

### 🔍 产品智能分析 🆕

使用 Google Gemini AI 自动分析产品图片，生成全方位产品洞察：

**分析维度：**

- 🎨 **外观特征**：形状、颜色、材质、设计特点
- ⚙️ **功能分析**：主要功能、使用方法、独特卖点
- 👥 **目标受众**：年龄、性别、职业、生活方式
- 📍 **使用场景**：地点、时机、环境
- 💡 **情感定位**：痛点、利益点、情感诉求

**特点：**

- 🚀 3-10秒完成分析
- 💰 成本极低（¥0.01-0.08/次）
- 📊 结构化数据存储
- 🔄 支持多LLM提供商

### 📚 文档导航

**UGC视频生成：**

- **[快速开始指南](./UGC_WORKFLOW_QUICK_START.md)** - 5分钟快速上手
- **[完整工作流指南](./UGC_WORKFLOW_GUIDE.md)** - 详细的技术文档和最佳实践
- **[可视化流程图](./UGC_WORKFLOW_DIAGRAM.md)** - 图解工作流程和架构

**产品分析功能：** 🆕

- **[快速入门](./docs/QUICK_START.md)** - 产品分析功能快速入门
- **[使用指南](./docs/PRODUCT_ANALYSIS_USAGE.md)** - 详细使用文档和示例
- **[实现总结](./docs/IMPLEMENTATION_SUMMARY.md)** - 技术实现说明
- **[验证清单](./docs/VERIFICATION_CHECKLIST.md)** - 测试和验证步骤

---

## 🚀 快速开始

### 安装依赖

```sh
npm install
```

### 开发环境

```sh
# 启动数据库
npm run db:start

# 启动开发服务器
npm run dev

# 启动 Worker（新终端窗口）
npm run worker:dev
```

### 生成UGC视频

```python
# 安装Python依赖
pip install google-genai pillow

# 设置API Key
export GOOGLE_API_KEY="your_api_key_here"

# 生成视频
from creative_video import generate_ugc_video_from_scratch

result = generate_ugc_video_from_scratch(
    product_images=["product.png"],
    target_duration=16
)
```

查看 [快速开始指南](./UGC_WORKFLOW_QUICK_START.md) 了解更多。

---

## 📦 项目结构

```
studio/
├── src/
│   ├── lib/
│   │   ├── components/      # Svelte组件
│   │   ├── server/          # 服务端代码
│   │   │   ├── db/          # 数据库Schema
│   │   │   ├── jobs/        # PgBoss任务队列 🆕
│   │   │   │   ├── handlers/    # 任务处理器
│   │   │   │   ├── pgBoss.ts   # PgBoss实例
│   │   │   │   ├── registry.ts # 任务注册
│   │   │   │   └── types.ts    # 任务类型定义
│   │   │   ├── services/    # 业务服务
│   │   │   │   ├── productImage.ts      # 图片上传管理
│   │   │   │   ├── productAnalysis.ts   # 产品AI分析
│   │   │   │   └── README.md           # 服务文档
│   │   │   └── storage/     # 存储层
│   │   └── stores/          # 状态管理
│   └── routes/              # 页面路由
│       ├── +page.svelte     # 首页（支持12s/24s视频）
│       ├── +page.server.ts  # Server Actions（含analyze）
│       ├── account/         # 账户管理
│       └── demo/            # 演示页面
├── docs/                    # 新增文档目录 🆕
│   ├── QUICK_START.md       # 产品分析快速入门
│   ├── PRODUCT_ANALYSIS_USAGE.md  # 使用指南
│   ├── IMPLEMENTATION_SUMMARY.md  # 实现总结
│   └── VERIFICATION_CHECKLIST.md  # 验证清单
├── static/                  # 静态资源
├── storage/                 # 本地文件存储
├── UGC_WORKFLOW_GUIDE.md    # UGC完整指南
├── UGC_WORKFLOW_QUICK_START.md  # 快速开始
├── UGC_WORKFLOW_DIAGRAM.md  # 流程图
├── WORKER.md                # Worker运行指南 🆕
├── worker.ts                # Worker进程入口 🆕
├── ecosystem.config.cjs     # PM2配置 🆕
├── Dockerfile.worker        # Worker Docker配置 🆕
├── compose.yaml             # Docker Compose配置
└── README.md                # 本文件
```

---

## 🛠️ 技术栈

- **前端**: SvelteKit 5
- **样式**: TailwindCSS
- **数据库**: PostgreSQL (Drizzle ORM)
- **任务队列**: pg-boss 🆕
- **认证**: Lucia Auth
- **国际化**: Paraglide
- **AI服务**:
  - Google Gemini 2.0 Flash (文本生成、产品分析) 🆕
  - Google Gemini 2.5 Flash (图片生成)
  - Google Veo 3.1 (视频生成)
- **LLM集成**: @google/genai 🆕

---

## 🎯 使用场景

- 📱 **电商卖家**: 为产品快速生成UGC视频
- 🏢 **品牌营销**: 批量制作社交媒体内容
- 🎨 **创意工作室**: 快速验证创意方向
- 📺 **内容创作者**: 自动化视频制作流程

---

## 📖 文档

### UGC视频生成

1. **[快速开始](./UGC_WORKFLOW_QUICK_START.md)**

   - 5分钟快速上手教程
   - 基础代码示例
   - 常见问题解答
2. **[完整工作流指南](./UGC_WORKFLOW_GUIDE.md)**

   - 两种生成模式详解
   - 最佳实践和优化建议
   - 完整代码实现
   - 成本和时间分析
3. **[可视化流程图](./UGC_WORKFLOW_DIAGRAM.md)**

   - 图解工作流程
   - 决策树和架构图
   - 系统组件说明

### 产品分析功能 🆕

4. **[快速入门](./docs/QUICK_START.md)**

   - 环境配置
   - 功能介绍
   - 使用示例
   - 成本估算
5. **[使用指南](./docs/PRODUCT_ANALYSIS_USAGE.md)**

   - 前端调用示例
   - API响应结构
   - 错误处理
   - 数据库记录
6. **[实现总结](./docs/IMPLEMENTATION_SUMMARY.md)**

   - 技术实现细节
   - 数据库设计
   - 可扩展性说明

### 数据库设计

7. **[数据库Schema设计](./DATABASE_SCHEMA.md)**

   - 完整的12个表结构设计
   - ER关系图
   - 查询示例和最佳实践
   - 存储估算和性能优化
8. **[数据库迁移指南](./DATABASE_MIGRATION.md)**

   - 如何应用新的schema
   - 使用Drizzle ORM
   - 开发和生产环境迁移
9. **[文件存储迁移方案](./STORAGE_MIGRATION_GUIDE.md)**

   - 从本地存储到CDN的平滑迁移
   - 存储抽象层设计（Adapter Pattern）
   - 支持多种存储后端（本地/Supabase/S3/CDN）
   - 零停机迁移方案

### 后台任务队列 🆕

10. **[Worker运行指南](./WORKER.md)**
    - Worker进程配置和运行
    - 多种后台运行方式（PM2/systemd/Docker）
    - 监控和日志管理
    - 生产环境部署最佳实践

---

## 🏗️ 构建和部署

### 构建生产版本

```sh
npm run build
```

### 预览生产版本

```sh
npm run preview
```

### 部署

项目使用SvelteKit，支持多种部署平台：

- **Vercel**: 自动部署（推荐）
- **Netlify**: 需要安装adapter-netlify
- **Node服务器**: 使用adapter-node
- **静态导出**: 使用adapter-static

查看 [SvelteKit适配器文档](https://svelte.dev/docs/kit/adapters) 了解更多。

---

## 🤝 贡献

欢迎贡献！请查看我们的贡献指南。

---

## 📄 许可证

MIT License

---

## 🔗 相关资源

- [SvelteKit文档](https://kit.svelte.dev/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Veo 3.1视频生成](https://ai.google.dev/docs/veo)
- [项目AGENTS指南](./AGENTS.md)

---

**构建强大的AI创意内容平台 🚀**
