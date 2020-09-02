import fs from 'fs';
import koaRouter from 'koa-router';

const router = koaRouter();

function addMapping(router, mapping) {
  mapping.forEach(item => {
    let method = (item.method === 'DELETE') ? 'del' : item.method.toLowerCase()
    router[method](item.path, item.func)
  })
}

function addControllers(router, dir) {
  var files = fs.readdirSync(__dirname + '/' + dir);
  var js_files = files.filter((f) => {
    return f.endsWith('.js');
  });

  for (var f of js_files) {
    let mapping = require(__dirname + '/' + dir + '/' + f);
    addMapping(router, mapping);
  }
}

module.exports = function (dir) {
    let _dir = dir || 'modules'; // 如果不传参数，扫描目录默认为'module'
    addControllers(router, _dir);
    return router.routes();
};
