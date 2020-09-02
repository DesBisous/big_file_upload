export default {
  origin: ctx => '*', // * 表示接受任意域名的请求
  exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'], // Access-Control-Expose-Headers
  maxAge: 5, // 表示 preflight request(预检请求)的返回结果 OPTIONS 的预检请求是否被缓存，如果为-1，则表示每次请求都要发送 OPTIONS 预检请求
  credentials: true, // 是否接受凭证 cookie
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], // 允许的请求方法
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-User-Token'], // 允许的请求头
};
