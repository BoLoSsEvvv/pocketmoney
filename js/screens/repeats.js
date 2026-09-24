// Список повторяющихся операций
import { h, money, shortDate, today } from '../util.js';
import { t } from '../i18n.js';
import * as M from '../model.js';
import { Screen, push, toolbar, backButton, chevron, swipeToDelete, datePicker, toast, confirmBox } from '../ui.js';
import { EditTxnScreen } from './txn.js';

export class RepeatsScreen extends Screen {
  nav() {
    return { title: t('Повторяющиеся'), left: backButton(t('Счета')) };
  }
  body() {
    const list = [...M.state.repeats].sort((a, b) => (a.next < b.next ? -1 : 1));
    if (!list.length) {
      return h('div', { class: 'empty' }, t('Повторяющихся операций нет.\n\nНажмите «+», чтобы добавить (зарплата, коммуналка, подписки…). Или откройте любую операцию и нажмите синюю стрелку рядом с датой.'));
    }
    return list.map((r) => {
      const x = r.tpl;
      const acc = M.account(x.acc);
      const payee = x.type === 't' ? `<${M.accName(x.to)}>` : x.payee || t('<без получателя>');
      const cat = x.splits?.length ? t('<--сплит-->') : x.category || '';
      const row = h('div', { class: 'txrow', onclick: () => push(new EditTxnScreen(null, { repeatId: r.id })) },
        h('div', { class: 'tx-date rep', style: { width: '76px' } }, shortDate(r.next), h('div', { style: { color: '#777', fontSize: '11px' } }, M.repeatLabel(r))),
        h('div', { class: 'tx-m' }, h('div', { class: 'tx-p' }, payee), h('div', { class: 'tx-c' }, cat)),
        h('div', { class: 'tx-r' },
          h('div', { class: 'tx-a ' + (x.amount > 0 ? 'pos' : 'neg') }, money(x.amount, M.curOf(acc))),
          h('div', { class: 'tx-b' }, acc?.name || '')),
        chevron());
      swipeToDelete(row, () => { M.removeRepeat(r.id); M.commit(); });
      return row;
    });
  }
  toolbar() {
    return toolbar(
      { icon: 'plus', onClick: () => push(new EditTxnScreen(M.newTxnDraft(), { newRepeat: true })) },
      '|',
      { label: t('Провести по дату'), onClick: () => this.process() },
    );
  }
  async process() {
    const d = await datePicker(today(), { title: t('Создать все повторы по дату') });
    if (!d) return;
    const n = M.postDueRepeats(d);
    M.commit();
    toast(n ? t('Создано операций: {0}', n) : t('Нечего создавать'));
  }
}
