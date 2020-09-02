import Koa from 'koa';
import logger from 'koa-logger';
import bodyParser from 'koa-bodyparser';
import cors from 'koa2-cors';
import corsConfig from './corsConfig';
import routes from './router';
import schedule from './schedule';

const app = new Koa();
const isProduction = process.env.NODE_ENV !== 'development';

// 日志
!isProduction ? app.use(logger()) : '';

// CORS 跨域配置
app.use(cors(corsConfig));

// koa-bodyparser
app.use(bodyParser());

// add router middleware:
app.use(routes());

// 定时器，用于定时清除文件碎片
schedule();

app.listen(9100);
console.log('koa 服务启动成功!');
