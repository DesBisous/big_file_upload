import Vue from 'vue'
import { Button, Progress, Message, Table, TableColumn} from 'element-ui';
import App from './App.vue'

Vue.config.productionTip = false;

Vue.use(Button);
Vue.use(Progress);
Vue.use(Table);
Vue.use(TableColumn);
Vue.prototype.$message = Message;

new Vue({
  render: h => h(App),
}).$mount('#app')
