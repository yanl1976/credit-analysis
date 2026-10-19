<template>
  <div v-if="!auth.hasPerm('system:manage')">
    <el-result icon="warning" title="无权访问" sub-title="系统设置需要「系统管理」权限，请联系管理员为你授权。" />
  </div>
  <div v-else>
    <div class="page-card">
      <h3 class="page-title">系统设置</h3>
      <p class="page-sub">组织架构、人员账号、角色权限与功能开关统一在此维护。</p>

      <el-tabs v-model="tab">
        <!-- 组织架构 -->
        <el-tab-pane label="组织架构" name="org">
          <div class="toolbar">
            <el-button type="primary" @click="openOrgDialog(null)">新增根组织</el-button>
            <el-button :disabled="!selectedOrg" @click="openOrgDialog(selectedOrg)">在选中下新增子组织</el-button>
            <el-button :disabled="!selectedOrg" @click="openOrgEdit">编辑选中</el-button>
            <el-button :disabled="!selectedOrg" type="danger" plain @click="removeOrg">删除选中</el-button>
            <span class="hint">共 {{ orgs.length }} 个组织；集团 / 子公司两级，子公司可再嵌套下级。</span>
          </div>
          <el-tree
            :data="orgTree"
            node-key="id"
            :props="{ label: 'org_name', children: 'children' }"
            default-expand-all
            highlight-current
            @node-click="(n) => (selectedOrg = n)"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <span>{{ data.org_name }}</span>
                <el-tag size="small" :type="data.org_type === 'GROUP' ? 'success' : 'info'" class="ml8">
                  {{ data.org_type === 'GROUP' ? '集团' : '子公司' }}
                </el-tag>
                <span class="tree-path">{{ data.path }}</span>
              </span>
            </template>
          </el-tree>
        </el-tab-pane>

        <!-- 人员 -->
        <el-tab-pane label="人员管理" name="user">
          <div class="toolbar">
            <el-input v-model="userKeyword" placeholder="用户名 / 姓名" clearable style="width: 220px" @keyup.enter="loadUsers" @clear="loadUsers" />
            <el-button @click="loadUsers">检索</el-button>
            <el-button type="primary" @click="openUserDialog(null)">新增人员</el-button>
            <span class="hint">共 {{ users.length }} 人；角色决定功能权限，所属组织决定数据范围。</span>
          </div>
          <el-table :data="users" border stripe>
            <el-table-column prop="username" label="用户名" width="160" />
            <el-table-column prop="realName" label="姓名" width="120" />
            <el-table-column prop="orgName" label="所属组织" min-width="160" />
            <el-table-column label="角色" min-width="200">
              <template #default="{ row }">
                <el-tag v-for="r in row.roles" :key="r.id" size="small" class="mr6">{{ r.roleName }}</el-tag>
                <span v-if="!row.roles?.length" class="muted">未分配角色</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openUserDialog(row)">编辑</el-button>
                <el-button link type="primary" @click="openRoleAssign(row)">分配角色</el-button>
                <el-button link type="warning" @click="resetPassword(row)">重置密码</el-button>
                <el-button link type="danger" @click="removeUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 角色 -->
        <el-tab-pane label="角色权限" name="role">
          <div class="toolbar">
            <el-button type="primary" @click="openRoleDialog(null)">新增角色</el-button>
            <span class="hint">共 {{ roles.length }} 个角色；权限项来自系统预置功能点。</span>
          </div>
          <el-table :data="roles" border stripe>
            <el-table-column prop="roleKey" label="角色标识" width="130" />
            <el-table-column prop="roleName" label="角色名称" width="160" />
            <el-table-column prop="orgName" label="所属组织" min-width="150" />
            <el-table-column prop="permCount" label="权限数" width="90" align="right" />
            <el-table-column prop="userCount" label="用户数" width="90" align="right" />
            <el-table-column prop="description" label="说明" min-width="180" />
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openRoleDialog(row)">编辑</el-button>
                <el-button link type="primary" @click="openPermDialog(row)">配置权限</el-button>
                <el-button link type="danger" :disabled="row.roleKey === 'ADMIN'" @click="removeRole(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 功能开关 -->
        <el-tab-pane label="功能开关" name="setting">
          <div v-for="g in settingGroups" :key="g.group" class="setting-group">
            <div class="group-title">{{ g.group }}</div>
            <div v-for="item in g.items" :key="item.key" class="setting-row">
              <div class="setting-label">
                <div>{{ item.label }}</div>
                <div class="setting-desc">{{ item.description }}</div>
              </div>
              <div class="setting-control">
                <el-switch v-if="item.type === 'boolean'" v-model="settingForm[item.key]" />
                <el-input-number
                  v-else-if="item.type === 'number'"
                  v-model="settingForm[item.key]"
                  :min="item.min"
                  :max="item.max"
                  :precision="item.decimals || 0"
                  :step="item.decimals ? 0.05 : 1"
                />
                <template v-else-if="item.secret">
                  <el-input
                    v-model="settingForm[item.key]"
                    type="password"
                    show-password
                    :maxlength="item.maxLength || 200"
                    :placeholder="item.hasValue ? '已配置，留空表示不修改' : '未配置'"
                    style="width: 260px"
                  />
                  <el-button v-if="item.hasValue" link type="danger" class="ml8" @click="clearSecret(item)">清除</el-button>
                  <el-tag v-if="item.hasValue" size="small" type="success" class="ml8">已配置</el-tag>
                </template>
                <el-input v-else v-model="settingForm[item.key]" :maxlength="item.maxLength || 60" style="width: 260px" />
              </div>
            </div>
          </div>
          <div class="toolbar">
            <el-button type="primary" :loading="savingSettings" @click="saveSettings">保存设置</el-button>
            <el-button @click="loadSettings">还原</el-button>
          </div>

          <el-divider />
          <div class="group-title">数据渠道</div>
          <el-alert type="info" :closable="false" :title="channelNote" class="mb12" />
          <el-table :data="channels" border size="small">
            <el-table-column prop="name" label="渠道" width="140" />
            <el-table-column prop="key" label="标识" width="120" />
            <el-table-column label="可用" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="row.configured ? 'success' : 'info'">
                  {{ row.configured ? '已启用' : '未配置' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="模式" width="200">
              <template #default="{ row }">
                <el-tag
                  v-if="row.mode"
                  size="small"
                  :type="row.mode === 'api' ? 'success' : row.mode === 'search' ? 'warning' : 'info'"
                >
                  {{ row.modeLabel || row.mode }}
                </el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="需鉴权" width="90">
              <template #default="{ row }">{{ row.requiresAuth ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column label="能力" min-width="200">
              <template #default="{ row }">
                <el-tag v-for="c in row.capabilities" :key="c" size="small" type="info" class="mr6">
                  {{ CAP_LABEL[c] || c }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="base" label="接口地址" min-width="220" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 组织弹窗 -->
    <el-dialog v-model="orgDialog" :title="orgForm.id ? '编辑组织' : '新增组织'" width="460px">
      <el-form :model="orgForm" label-width="90px">
        <el-form-item label="上级组织">
          <span>{{ parentName(orgForm.parentId) }}</span>
        </el-form-item>
        <el-form-item label="组织名称" required>
          <el-input v-model="orgForm.orgName" maxlength="40" />
        </el-form-item>
        <el-form-item label="组织类型">
          <el-select v-model="orgForm.orgType" style="width: 100%">
            <el-option label="集团" value="GROUP" />
            <el-option label="子公司" value="SUB" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="orgDialog = false">取消</el-button>
        <el-button type="primary" @click="saveOrg">保存</el-button>
      </template>
    </el-dialog>

    <!-- 人员弹窗 -->
    <el-dialog v-model="userDialog" :title="userForm.id ? '编辑人员' : '新增人员'" width="520px">
      <el-form :model="userForm" label-width="90px">
        <el-form-item label="用户名" required>
          <el-input v-model="userForm.username" :disabled="!!userForm.id" maxlength="32" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="userForm.realName" maxlength="20" />
        </el-form-item>
        <el-form-item label="所属组织" required>
          <el-select v-model="userForm.orgId" style="width: 100%">
            <el-option v-for="o in orgOptions" :key="o.id" :label="o.org_name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="userForm.id ? '重置密码' : '初始密码'" :required="!userForm.id">
          <el-input v-model="userForm.password" type="password" show-password placeholder="至少 6 位，留空则不修改" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="userForm.roleIds" multiple style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="`${r.roleName}（${r.roleKey}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="userForm.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配角色 -->
    <el-dialog v-model="assignDialog" title="分配角色" width="420px">
      <div class="mb8">用户：{{ assignUser?.username }}（{{ assignUser?.realName || '-' }}）</div>
      <el-select v-model="assignRoleIds" multiple style="width: 100%">
        <el-option v-for="r in roles" :key="r.id" :label="`${r.roleName}（${r.roleKey}）`" :value="r.id" />
      </el-select>
      <template #footer>
        <el-button @click="assignDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAssign">保存</el-button>
      </template>
    </el-dialog>

    <!-- 角色弹窗 -->
    <el-dialog v-model="roleDialog" :title="roleForm.id ? '编辑角色' : '新增角色'" width="480px">
      <el-form :model="roleForm" label-width="90px">
        <el-form-item label="角色标识" required>
          <el-input v-model="roleForm.roleKey" :disabled="!!roleForm.id" placeholder="如 MANAGER / VIEWER" maxlength="32" />
        </el-form-item>
        <el-form-item label="角色名称" required>
          <el-input v-model="roleForm.roleName" maxlength="40" />
        </el-form-item>
        <el-form-item label="所属组织" required>
          <el-select v-model="roleForm.orgId" style="width: 100%" :disabled="!!roleForm.id">
            <el-option v-for="o in orgOptions" :key="o.id" :label="o.org_name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>

    <!-- 配置权限 -->
    <el-dialog v-model="permDialog" title="配置角色权限" width="560px">
      <div class="mb8">角色：{{ permRole?.roleName }}（{{ permRole?.roleKey }}）</div>
      <el-checkbox-group v-model="permIds">
        <div v-for="p in permissions" :key="p.id" class="perm-row">
          <el-checkbox :value="p.id">
            <b>{{ p.perm_name }}</b>
            <span class="perm-key">{{ p.perm_key }}</span>
            <span class="perm-desc">{{ p.description }}</span>
          </el-checkbox>
        </div>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="permDialog = false">取消</el-button>
        <el-button type="primary" @click="savePerms">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import { ElMessage } from '../utils/feedback.js';
import { orgApi, userApi, roleApi, permissionApi, settingApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const tab = ref('org');

const orgs = ref([]);
const orgTree = ref([]);
const selectedOrg = ref(null);
const users = ref([]);
const userKeyword = ref('');
const roles = ref([]);
const permissions = ref([]);
const settingGroups = ref([]);
const settingForm = reactive({});
const channels = ref([]);
const channelNote = ref('');
const savingSettings = ref(false);

// 渠道能力标签中文名
const CAP_LABEL = {
  basic: '工商信息',
  verify: '主体核验',
  judicial: '司法风险',
  credit: '合规风险',
  finance: '财务线索',
};

const orgOptions = computed(() => orgs.value);

function parentName(parentId) {
  if (!parentId) return '（根组织）';
  return orgs.value.find((o) => Number(o.id) === Number(parentId))?.org_name || parentId;
}

async function loadOrgs() {
  const [flat, tree] = await Promise.all([orgApi.list(), orgApi.tree()]);
  orgs.value = flat || [];
  orgTree.value = tree || [];
  if (selectedOrg.value) {
    selectedOrg.value = orgs.value.find((o) => Number(o.id) === Number(selectedOrg.value.id)) || null;
  }
}

async function loadUsers() {
  users.value = (await userApi.list({ keyword: userKeyword.value || undefined })) || [];
}

async function loadRoles() {
  roles.value = (await roleApi.list()) || [];
}

async function loadPermissions() {
  permissions.value = (await permissionApi.list()) || [];
}

async function loadSettings() {
  settingGroups.value = (await settingApi.grouped()) || [];
  for (const g of settingGroups.value) {
    for (const it of g.items) settingForm[it.key] = it.value;
  }
  const c = await settingApi.channels();
  channels.value = c.channels || [];
  channelNote.value = c.note || '';
}

// 密钥项：清空输入 = 不修改；点「清除」提交该标记由后端删除
const SECRET_CLEAR = '__CLEAR__';

function clearSecret(item) {
  settingForm[item.key] = SECRET_CLEAR;
  ElMessage.info(`「${item.label}」将在保存后清除`);
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    const values = {};
    for (const g of settingGroups.value) for (const it of g.items) values[it.key] = settingForm[it.key];
    await settingApi.save(values);
    await loadSettings(); // 重新拉设置（密钥回到掩码态）并刷新渠道状态
    ElMessage.success('设置已保存，渠道配置已即时生效');
  } finally {
    savingSettings.value = false;
  }
}

// 组织
const orgDialog = ref(false);
const orgForm = reactive({ id: null, parentId: 0, orgName: '', orgType: 'SUB' });

function openOrgDialog(parent) {
  Object.assign(orgForm, {
    id: null,
    parentId: parent ? Number(parent.id) : 0,
    orgName: '',
    orgType: parent ? 'SUB' : 'GROUP',
  });
  orgDialog.value = true;
}

function openOrgEdit() {
  const o = selectedOrg.value;
  if (!o) return;
  Object.assign(orgForm, { id: o.id, parentId: o.parent_id, orgName: o.org_name, orgType: o.org_type });
  orgDialog.value = true;
}

async function saveOrg() {
  if (!orgForm.orgName.trim()) return ElMessage.warning('请填写组织名称');
  if (orgForm.id) {
    await orgApi.update(orgForm.id, { orgName: orgForm.orgName, orgType: orgForm.orgType });
  } else {
    await orgApi.create({ parentId: orgForm.parentId, orgName: orgForm.orgName, orgType: orgForm.orgType });
  }
  ElMessage.success('已保存');
  orgDialog.value = false;
  await loadOrgs();
}

async function removeOrg() {
  const o = selectedOrg.value;
  if (!o) return;
  await ElMessageBox.confirm(`确认删除组织「${o.org_name}」？存在下级组织/用户/角色时不允许删除。`, '删除确认', { type: 'warning' });
  await orgApi.remove(o.id);
  selectedOrg.value = null;
  ElMessage.success('已删除');
  await loadOrgs();
}

// 人员
const userDialog = ref(false);
const userForm = reactive({
  id: null,
  username: '',
  realName: '',
  orgId: null,
  password: '',
  roleIds: [],
  status: 1,
});

function openUserDialog(row) {
  if (row) {
    Object.assign(userForm, {
      id: row.id,
      username: row.username,
      realName: row.realName || '',
      orgId: row.orgId,
      password: '',
      roleIds: (row.roles || []).map((r) => r.id),
      status: row.status,
    });
  } else {
    Object.assign(userForm, {
      id: null,
      username: '',
      realName: '',
      orgId: selectedOrg.value?.id || orgs.value[0]?.id || null,
      password: '',
      roleIds: [],
      status: 1,
    });
  }
  userDialog.value = true;
}

async function saveUser() {
  if (!userForm.id && (!userForm.username.trim() || !userForm.password)) {
    return ElMessage.warning('新增人员需填写用户名与初始密码');
  }
  if (userForm.password && userForm.password.length < 6) return ElMessage.warning('密码至少 6 位');
  if (!userForm.orgId) return ElMessage.warning('请选择所属组织');
  if (userForm.id) {
    const body = { realName: userForm.realName, status: userForm.status, orgId: userForm.orgId };
    if (userForm.password) body.password = userForm.password;
    await userApi.update(userForm.id, body);
    await userApi.assignRoles(userForm.id, userForm.roleIds);
  } else {
    await userApi.create({
      orgId: userForm.orgId,
      username: userForm.username.trim(),
      password: userForm.password,
      realName: userForm.realName,
      status: userForm.status,
      roleIds: userForm.roleIds,
    });
  }
  ElMessage.success('已保存');
  userDialog.value = false;
  await loadUsers();
}

async function resetPassword(row) {
  const { value } = await ElMessageBox.prompt(`为「${row.username}」设置新密码（至少 6 位）`, '重置密码', {
    inputType: 'password',
    inputPattern: /.{6,}/,
    inputErrorMessage: '密码至少 6 位',
  });
  await userApi.update(row.id, { password: value });
  ElMessage.success('密码已重置');
}

async function removeUser(row) {
  await ElMessageBox.confirm(`确认删除人员「${row.username}」？`, '删除确认', { type: 'warning' });
  await userApi.remove(row.id);
  ElMessage.success('已删除');
  await loadUsers();
}

const assignDialog = ref(false);
const assignUser = ref(null);
const assignRoleIds = ref([]);

function openRoleAssign(row) {
  assignUser.value = row;
  assignRoleIds.value = (row.roles || []).map((r) => r.id);
  assignDialog.value = true;
}

async function saveAssign() {
  await userApi.assignRoles(assignUser.value.id, assignRoleIds.value);
  ElMessage.success('角色已更新');
  assignDialog.value = false;
  await loadUsers();
}

// 角色
const roleDialog = ref(false);
const roleForm = reactive({ id: null, roleKey: '', roleName: '', orgId: null, description: '' });

function openRoleDialog(row) {
  if (row) {
    Object.assign(roleForm, {
      id: row.id,
      roleKey: row.roleKey,
      roleName: row.roleName,
      orgId: row.orgId,
      description: row.description || '',
    });
  } else {
    Object.assign(roleForm, {
      id: null,
      roleKey: '',
      roleName: '',
      orgId: selectedOrg.value?.id || orgs.value[0]?.id || null,
      description: '',
    });
  }
  roleDialog.value = true;
}

async function saveRole() {
  if (!roleForm.roleKey.trim() || !roleForm.roleName.trim()) return ElMessage.warning('请填写角色标识与名称');
  if (!roleForm.orgId) return ElMessage.warning('请选择所属组织');
  if (roleForm.id) {
    await roleApi.update(roleForm.id, { roleName: roleForm.roleName, description: roleForm.description });
  } else {
    await roleApi.create({
      orgId: roleForm.orgId,
      roleKey: roleForm.roleKey.trim().toUpperCase(),
      roleName: roleForm.roleName,
      description: roleForm.description,
    });
  }
  ElMessage.success('已保存');
  roleDialog.value = false;
  await loadRoles();
}

async function removeRole(row) {
  await ElMessageBox.confirm(`确认删除角色「${row.roleName}」？`, '删除确认', { type: 'warning' });
  await roleApi.remove(row.id);
  ElMessage.success('已删除');
  await loadRoles();
}

// 权限
const permDialog = ref(false);
const permRole = ref(null);
const permIds = ref([]);

async function openPermDialog(row) {
  permRole.value = row;
  const current = await roleApi.permissions(row.id);
  permIds.value = (current || []).map((p) => p.id);
  permDialog.value = true;
}

async function savePerms() {
  await roleApi.assignPermissions(permRole.value.id, permIds.value);
  ElMessage.success('权限已保存，相关用户重新登录后生效');
  permDialog.value = false;
  await loadRoles();
}

onMounted(async () => {
  if (!auth.hasPerm('system:manage')) return;
  await Promise.all([loadOrgs(), loadUsers(), loadRoles(), loadPermissions(), loadSettings()]);
});
</script>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tree-path {
  color: #c0c4cc;
  font-size: 12px;
  margin-left: 8px;
}
.ml8 {
  margin-left: 8px;
}
.mr6 {
  margin-right: 6px;
}
.mb8 {
  margin-bottom: 8px;
}
.mb12 {
  margin-bottom: 12px;
}
.muted {
  color: #c0c4cc;
  font-size: 12px;
}
.hint {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}
.setting-group {
  margin-bottom: 18px;
}
.group-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed #ebeef5;
  gap: 16px;
}
.setting-desc {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
.perm-row {
  padding: 6px 0;
  border-bottom: 1px dashed #f2f6fc;
}
.perm-key {
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}
.perm-desc {
  color: #c0c4cc;
  font-size: 12px;
  margin-left: 8px;
}
</style>
