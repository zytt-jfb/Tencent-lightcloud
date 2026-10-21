import MaintenanceTable from './MaintenanceTable';
import { VIEWS, formSections } from './maintenance-config';

/**
 * 人员管理。
 * 与车辆/油机的差异只有「业务列 + 详情列 + 表单分区」，共享逻辑在 MaintenanceTable。
 * 人员的合规口径（三证齐全 + 雇主责任险有效）定义在 maintenance-compliance.ts。
 */
const SECTIONS = formSections('personnel');

export default function PersonnelList() {
  return (
    <MaintenanceTable
      kind="personnel"
      businessColumns={VIEWS.personnel.main}
      detailFields={VIEWS.personnel.detail}
      sections={SECTIONS}
    />
  );
}
