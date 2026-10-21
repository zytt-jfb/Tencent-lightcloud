import MaintenanceTable from './MaintenanceTable';
import { VIEWS, formSections } from './maintenance-config';

/** 车辆管理。合规口径 = 交强险 + 商业险均在有效期内 */
const SECTIONS = formSections('vehicles');

export default function VehicleList() {
  return (
    <MaintenanceTable
      kind="vehicles"
      businessColumns={VIEWS.vehicles.main}
      detailFields={VIEWS.vehicles.detail}
      sections={SECTIONS}
    />
  );
}
