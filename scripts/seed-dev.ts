/**
 * Demo data for LOCAL DEVELOPMENT / E2E only. Never run against staging or production:
 * refuses unless ALLOW_DEV_SEED=1 and the database name contains "dev", "e2e" or "test".
 */
import { createSql, setSql } from '../src/server/db';
import { bootstrap } from './bootstrap-lib';
import { createFeedback } from '../src/modules/feedback/service';
import { createPersonTag, createTag, createTagGroup, setUserPersonTags, getTaxonomy } from '../src/modules/products/taxonomy';
import { postScheduleComment } from '../src/modules/schedule/service';
import { createGeneralComment } from '../src/modules/feedback/comments';
import { createRoadmap } from '../src/modules/roadmap/service';

const url = process.env.DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev';
const dbName = new URL(url).pathname.slice(1);
if (process.env.ALLOW_DEV_SEED !== '1' || !/(dev|e2e|test)/.test(dbName)) {
  console.error('Refusing to seed: set ALLOW_DEV_SEED=1 and use a dev/e2e/test database.');
  process.exit(1);
}
const sql = createSql(url, 2);
setSql(sql, url);

async function main() {
  await bootstrap(sql, { teamEmail: null });
  const [existing] = await sql`select 1 from users where verified_email = 'lead@dev.local'`;
  if (existing) {
    console.log('Dev seed already present.');
    return;
  }
  await sql.begin(async (tx0) => {
    const tx = tx0 as never;
    const mk = async (email: string, name: string, role: string) => {
      const [u] = await tx0`insert into users (google_sub, verified_email, display_name, role) values (${`test-${email}`}, ${email}, ${name}, ${role}) returning id, display_name, avatar_path, google_picture_url, revision`;
      return u as { id: string; displayName: string; avatarPath: null; googlePictureUrl: null; revision: number };
    };
    const lead = await mk('lead@dev.local', '林佳慧', 'team');
    const dev = await mk('dev@dev.local', '陳志明', 'team');
    const qa = await mk('qa@dev.local', '王小美', 'team');
    const tester = await mk('tester@dev.local', '測試者 張', 'tester');
    const [p] = await tx0<{ id: string }[]>`select id from products where system_key = 'initial'`;
    await tx0`insert into product_access (user_id, product_id) values (${tester.id}, ${p.id})`;
    let rev = (await getTaxonomy(tx, p.id)).productRevision;
    const pt = async (n: string) => { const r = await createPersonTag(tx, p.id, n, rev); rev = r.productRevision; return r.personTag.id; };
    const uiux = await pt('UIUX');
    const fe = await pt('前端');
    const be = await pt('後端');
    const qaTag = await pt('QA');
    const tax = await getTaxonomy(tx, p.id);
    const version = tax.tagGroups.find((g) => g.systemKey === 'version')!.id;
    const tag = async (n: string, g: string | null) => { const r = await createTag(tx, p.id, { name: n, groupId: g }, rev); rev = r.productRevision; return r.tag.id; };
    const v10 = await tag('v1.0', version);
    const v11 = await tag('v1.1', version);
    const g = await createTagGroup(tx, p.id, { name: '影響範圍', selectionMode: 'multiple' }, rev); rev = g.productRevision;
    const perf = await tag('效能', g.group.id);
    const ux = await tag('介面', g.group.id);
    for (const [u, tags] of [[lead, [uiux]], [dev, [fe, be]], [qa, [qaTag]]] as const) {
      rev = (await setUserPersonTags(tx, p.id, u.id, [...tags], rev)).productRevision;
    }
    const statuses = (await getTaxonomy(tx, p.id)).statuses;
    const items: [string, string, number, string[], string[], 'internal' | 'public'][] = [
      ['回饋列表支援鍵盤操作', '使用方向鍵在列表間移動焦點，Enter 開啟。', 0, [fe, uiux], [v11, ux], 'public'],
      ['搜尋支援繁體中文片段', '輸入「欄位」也能找到「搜尋欄位」。', 1, [be], [v10, perf], 'public'],
      ['Roadmap 拖曳後同步版本', '版本看板拖曳要同時更新版本欄位。', 1, [fe], [v11], 'internal'],
      ['Personal 私人欄位自動儲存', '整理後不需要按儲存。', 2, [fe, uiux], [], 'internal'],
      ['匯出 CSV（待討論）', '是否第一版需要？', 2, [], [], 'internal'],
      ['登入頁說明文字調整', '', 3, [uiux], [v10, ux], 'public'],
      ['QA：Schedule 清空不復活', '驗證移除清空紀錄不會恢復內容。', 0, [qaTag], [v11], 'internal'],
      ['日曆全天活動顯示', '跨日活動結束日要正確。', 4, [fe], [], 'internal'],
    ];
    for (const [title, description, si, people, tags, visibility] of items) {
      const versionTag = tags.find((t) => t === v10 || t === v11) ?? null;
      const fb = await createFeedback(tx, lead, p.id, {
        title, description, statusId: statuses[si].id, personTagIds: people, tagIds: tags.filter((t) => t !== versionTag), versionTagId: versionTag, visibility,
      }, 'admin');
      if (title.startsWith('回饋列表')) {
        let r = await postScheduleComment(tx, dev, p.id, fb.id, { body: '/2-3 規劃焦點順序', expectedRevision: 1 });
        r = await postScheduleComment(tx, lead, p.id, fb.id, { body: '/2-2 提供焦點樣式稿', expectedRevision: r.scheduleRevision });
        await postScheduleComment(tx, qa, p.id, fb.id, { body: '測試時請包含螢幕閱讀器。', expectedRevision: r.scheduleRevision });
        await createGeneralComment(tx, tester, p.id, fb.id, { body: '很需要這個功能！' }, 'portal');
      }
    }
    await createRoadmap(tx, p.id, { name: '版本規畫', description: '依版本群組分欄', dimension: 'tag_group', tagGroupId: version });
    await tx0`update roadmaps set portal_published = true where product_id = ${p.id} and is_default`;
  });
  console.log('Dev seed created: lead@dev.local (team), dev@dev.local, qa@dev.local, tester@dev.local (tester). Use the test login (E2E_TEST_LOGIN=enabled).');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
