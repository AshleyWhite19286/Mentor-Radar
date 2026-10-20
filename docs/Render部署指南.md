# Render免费演示部署

此方案保留现有页面、Node.js后台任务和SQLite，适合先分享一个可用的网址。访问者共用一份演示数据；新增内容、修订和任务可能在实例休眠、重启或重新部署后清除，预置的`data/seed.json`及照片不会因此丢失。

## 1. 准备GitHub仓库

将项目推送到自己的GitHub仓库，可以设为私有。不要上传`.env.local`、真实API Key、`data/local.sqlite`及其WAL文件。`.env.example`中的Key应保持为空。如果真实Key曾经提交到Git历史，清空当前文件不能撤销历史凭证，应在模型提供方撤销旧Key。

本地检查：

```bash
npm ci
npm test
npm run typecheck
npm run build
```

## 2. 使用Blueprint部署

1. 打开 https://dashboard.render.com/ 并登录。
2. 选择 **New → Blueprint**，连接GitHub并选择项目仓库和部署分支。
3. Render读取根目录的`render.yaml`。确认服务为`mentor-radar`，方案为 **Free**，点击创建并部署。
4. 等待构建和启动完成，打开服务页面提供的`https://…onrender.com`地址。

无需手动填写模型Key或数据库连接。Render自动提供`PORT`和`RENDER_EXTERNAL_URL`；应用使用前者监听服务端口，后者允许当前公网域名的请求。

也可选择 **New → Web Service** 手动连接仓库，填入：

| 配置项 | 值 |
| --- | --- |
| Language | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start:public` |
| Instance Type | Free |
| Health Check Path | `/` |
| 环境变量 | `NODE_VERSION=22.22.0` |

## 3. 在现有页面使用

打开首页，检查导师名录、研究所导览、教师详情及照片；也可以直接打开`/api/catalog`确认目录接口返回JSON。

点击右上角“模型设置”，填入自己的Key，获取模型并测试连接，然后体验个人匹配和证据追问。凭证刷新后清除。云服务器访问学校模型接口的可达性仍需实际验证，模型调用费用取决于提供方。

## 自定义域名或其他Node.js平台

配置`RADAR_PUBLIC_ORIGIN=https://你的域名`，只填源地址，不带路径、查询参数或凭证；随后重启服务。它优先于Render自动域名，因此请从配置的域名访问页面。

本地模拟代理后的公网请求：

```bash
RADAR_PUBLIC_ORIGIN=https://radar.example.com PORT=3001 npm run start:public
```

在另一个终端请求目录：

```bash
curl -H 'Host: radar.example.com' http://127.0.0.1:3001/api/catalog
```

## 免费版限制与排查

- 闲置15分钟后实例会休眠，重新访问通常约需1分钟唤醒。
- 本地新增数据不持久保存；演示前先访问一次，并在当前会话中准备新增内容。
- 如果页面能打开但目录加载失败，检查`RENDER_EXTERNAL_URL`或`RADAR_PUBLIC_ORIGIN`是否与访问域名一致。
- 如果模型测试失败，先核对Key、模型名称和接口地址，再检查Render日志及模型服务的网络限制。
- 更新代码并推送部署分支后，Render可自动重新构建和部署。

官方说明：[Next.js部署](https://render.com/docs/deploy-nextjs-app)、[免费实例限制](https://render.com/docs/free)、[Blueprint配置](https://render.com/docs/blueprint-spec)、[默认环境变量](https://render.com/docs/environment-variables)。
