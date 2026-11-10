# Film Shelf

个人影视记录。管理端可选择「电影 / 电视剧」和「TMDB / 豆瓣」，通过名称搜索，核对年份、国家和季别后导入。导入会保存本地主封面、上映或首播日期、简介、主演和可用的剧集集数，并归入「想看」；看完后手动切换为「已观影」。用户端首页依次展示「想看」和「近日观影」，可筛选电影或电视剧，每个区块分页显示两行海报。点击作品查看详情；有磁力链接时展示完整链接及复制按钮。TMDB 演员可浏览其参演电影或电视剧，并查看片库状态和详情。

每条记录对应所选资料源中的一个条目。TMDB 可能按整剧收录，豆瓣可能每季一个条目；集数和「已观影」均针对选中的条目，不代表逐集观看进度。不同来源不会按同名自动合并，跨来源导入前请核对是否已在片库中。

## 技术与目录

- Bun workspace，统一用 Bun 安装依赖、运行和测试。
- `apps/admin`：React、React Router、Vite、Tailwind CSS，基于 shadcn/ui `dashboard-01`。
- `apps/api`：Hono + TypeScript、Drizzle ORM、Bun SQLite，内置 TMDB 与匿名豆瓣资料适配器，不依赖额外 CLI。
- `packages/shared`：前后端共用的数据类型。
- `apps/web`：React、React Router 用户端，在同一首页浏览「想看」和「近日观影」，点击电影查看详情。

当前范围没有账号、评分、评论、播放服务等功能，应用默认只在本机 `127.0.0.1` 提供访问。

## 启动

需要 Bun 1.4 或更新版本。在项目根目录执行：

```sh
bun install
cp .env.example .env
```

如果 `.env` 已存在，请直接编辑，避免覆盖已有 Token。在 [TMDB API 设置](https://www.themoviedb.org/settings/api) 获取 **API Read Access Token**，填写根目录 `.env`：

```dotenv
TMDB_READ_ACCESS_TOKEN=你的只读访问令牌
DATABASE_PATH=./data/film-shelf.sqlite
PORT=3101
```

Token 只在服务端读取，不要添加 `VITE_` 前缀或提交到 Git。未配置时可使用豆瓣搜索和导入，也可浏览本地数据和切换状态；TMDB 搜索及远程演员作品查询会提示配置缺失。修改 Token 后重启开发服务。豆瓣公开查询不需要登录或 Cookie，也不需要安装 douban-cli；站点限流、安全验证或接口变化时会提示错误，不会自动尝试绕过验证。

服务器若无法正确解析默认 TMDB 域名，可配置 `TMDB_API_HOST=api.tmdb.org`。仅允许 `api.themoviedb.org`（默认）和 `api.tmdb.org` 两个 API 域名，继续使用 HTTPS 证书校验和同一服务端 Token。

```sh
bun run dev
```

- 管理端：[http://127.0.0.1:5173](http://127.0.0.1:5173)
- 用户端：[http://127.0.0.1:5174](http://127.0.0.1:5174)
- API：[http://127.0.0.1:3101/api/health](http://127.0.0.1:3101/api/health)

启动会自动执行已提交的 Drizzle 迁移并创建 SQLite 文件，不需要提前安装数据库。相对 `DATABASE_PATH` 始终以项目根目录为基准。开发代理自动读取根目录 `.env` 的 `PORT`；修改后重启开发服务即可。

## 使用

1. 点击「添加影视」，选择资料来源和作品类型，输入中文或原文名称。未配置 TMDB Token 时默认使用豆瓣。
2. 从候选结果核对名称、海报、年份、国家和季别，点击「加入想看」获取完整详情后保存；搜索候选缺少日期或简介时，导入会重新查询完整资料。
3. 所有作品保存在同一张表格中，可筛选电影或电视剧，点击名称查看已保存的简介、上映或首播日期、主演及剧集集数。
4. 看完后直接在表格的状态列切换为「已观影」，需要时可切回「想看」。
5. 添加电影时可填写磁力链接；已有电影点击「磁力链接」列或片名打开详情后，可编辑并保存链接，留空保存可清除。
6. 用户端点击主演进入演员作品页，可切换电影或电视剧；作品按上映或首播日期倒序分页展示，仅对已观影作品显示「已观影」标记。豆瓣主演通过 IMDb 编号唯一关联 TMDB；没有对应记录时查询豆瓣参演作品。未收录作品也能查看只读详情，浏览不会自动加入片库。演员照片保存到本地，旧条目启动后会后台补齐演员身份。录入和状态修改仍在管理端完成。

「已观影」片单按标记已观影的先后倒序展示，新标记的电影排在前面；编辑磁力链接或重复标记不会改变顺序。切回想看后再次标记已观影，会作为新的记录排到前面。升级前已有影片保持原来的相对顺序。

数据保存到本地 SQLite，重启服务后仍保留。同一类型的 TMDB ID 唯一，豆瓣 ID 唯一，重复导入会明确提示；TMDB 电影与电视剧使用相同数字 ID 时可以并存。升级会原位新增媒体类型、豆瓣 ID 和集数字段，旧记录默认为电影，保留已有本地 ID、状态、观影顺序、磁力链接及图片引用。

影视海报会下载到项目根目录 `data/posters/`，数据库及页面使用 `/api/posters/…` 本地地址。搜索候选、演员作品海报和演员照片在浏览器首次请求该图片时缓存到本地。每部作品保存一张主封面；豆瓣导入优先使用详情接口实际返回的高清图，搜索中的签名小图仅作预览。新作品须完成原图保存后才入库，服务会同时为适合缩小的海报生成 200、360、480 像素宽的 WebP 缩略图。首页按屏幕选择缩略图，详情页使用原图。启动时会保存已有影片的远程海报，并补齐缺失的缩略图。没有图片时显示占位图。备份片库时请同时备份整个 `data/` 目录。

自动生成缩略图需要在服务环境中提供 `cwebp` 1.6.0 和 `ffprobe`，也可以用 `FILM_SHELF_CWEBP` 指定 `cwebp` 的路径。原图太小、缩略图无法减小文件体积或暂时无法生成时，首页会使用原图。

## 本机构建与检查

```sh
bun run typecheck
bun test
bun run build
bun run start
```

构建后 API 服务同时提供管理端和用户端静态文件：管理端访问 [http://127.0.0.1:3101](http://127.0.0.1:3101)，用户端访问 [http://127.0.0.1:3101/app/](http://127.0.0.1:3101/app/)。API 不需要单独转译，直接由 Bun 执行 TypeScript。

数据库结构变更后执行 `bun run db:generate` 生成新迁移，再执行 `bun run db:migrate`。迁移与 schema 都在 `apps/api`。SQLite 文件、WAL 文件和 `.env` 已加入忽略规则。

## Codex 录入与 API

所有 API 返回 JSON；错误统一为 `{ "error": { "code": "…", "message": "…" } }`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务及 TMDB 配置状态 |
| GET | `/api/tmdb/search?q=电影名` | 搜索 TMDB 候选 |
| GET | `/api/metadata/search?provider=douban&mediaType=tv&q=我的大叔` | 按来源和类型搜索，返回带 `provider`、`mediaType`、`externalId` 的候选；来源可为 `tmdb` 或 `douban` |
| POST | `/api/movies/import` | 传入 `{ "provider": "douban", "mediaType": "tv", "externalId": 27602137 }`，可附带 `magnetUrl`；旧 `{ "tmdbId": 550 }` 请求仍表示 TMDB 电影 |
| POST | `/api/movies` | Codex 直接录入已核实的电影资料 |
| GET | `/api/movies?status=recommended&mediaType=tv&page=1&pageSize=20&q=片名` | 分页列表，status、mediaType 和 q 可省略；不传类型时返回全部作品 |
| GET | `/api/movies/:id` | 查看电影详情 |
| GET | `/api/actors/:id/movies?mediaType=tv&page=1&pageSize=24` | 通过 TMDB 演员 ID 查看参演作品，附带当前片库状态；类型默认 movie |
| GET | `/api/actors/:id/movies?provider=douban&mediaType=tv` | 使用豆瓣演员 ID，优先精确关联 TMDB，未匹配时查询豆瓣参演作品 |
| GET | `/api/catalog/movies/:tmdbId` | 只读电影详情；已收录时优先返回本地资料，否则获取 TMDB 资料，不新增片库记录 |
| GET | `/api/catalog/tv/:tmdbId` | 对应的 TMDB 电视剧只读详情，与同号电影隔离 |
| GET | `/api/catalog/douban/movies/:id`、`/api/catalog/douban/tv/:id` | 豆瓣作品只读详情，已收录时优先本地资料 |
| PATCH | `/api/movies/:id/status` | `{ "status": "watched" }` 或 `{ "status": "recommended" }` |
| PATCH | `/api/movies/:id/magnet` | `{ "magnetUrl": "magnet:?xt=urn:btih:…" }`；传入 null 或空白字符串可清除 |

直接录入格式如下，`title` 必填，其余字段可省略。`mediaType` 默认 `movie`，可选 `tv`；`doubanId` 可空，`episodeCount` 仅电视剧可填正整数，未知时留空或 null。所有新作品默认想看；只有用户手动标记后才成为已观影。

```json
{
  "title": "电影名称",
  "originalTitle": "Original Title",
  "tmdbId": 550,
  "releaseDate": "1999-10-15",
  "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg",
  "overview": "已核实的电影简介",
  "magnetUrl": null,
  "cast": [
    { "tmdbPersonId": 819, "name": "演员姓名", "character": "角色姓名", "profileUrl": null }
  ]
}
```

测试使用真实的临时 SQLite 和模拟 TMDB 响应，不会写入个人电影库，也不代表真实 Token 或外网已验收。

## 资料来源

影视资料与图片来自所选的 [TMDB](https://www.themoviedb.org/) 或[豆瓣](https://movie.douban.com/)，详情页保留来源条目链接。豆瓣查询方式参考 [douban-cli](https://github.com/Marvae/douban-cli)，本项目自行实现服务端适配器。This product uses the TMDB API but is not endorsed or certified by TMDB.

模板来源：[shadcn/ui dashboard-01](https://ui.shadcn.com/view/new-york-v4/dashboard-01)。沿用官方 new-york-v4 页面框架、侧栏、顶栏和表格样式，仅将数据及操作改为观影管理。管理端只有一个「电影管理」菜单和一张电影表格；不提供概览卡片、图表或按状态拆分的菜单。
