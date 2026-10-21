import MaintenanceTable from './MaintenanceTable';
import { VIEWS, formSections } from './maintenance-config';

/**
 * 油机管理。
 * 油机没有约定合规口径（用户只确认了人员与车辆），合规列只显示保养记录登记情况，
 * 不参与「合规/不合规」判定。
 */
const SECTIONS = formSections('generators');

export default function GeneratorList() {
  return (
    <MaintenanceTable
      kind="generators"
      businessColumns={VIEWS.generators.main}
      detailFields={VIEWS.generators.detail}
      sections={SECTIONS}
    />
  );
}
