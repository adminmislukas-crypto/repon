import { ScreenStub } from '@/components/ScreenStub';
import { AuthWiringProbe, REPON_AUTH_PACKAGE_ID } from '@repon/auth';

export default function DashboardScreen() {
  return (
    <>
      <ScreenStub
        title="Dashboard"
        description={`Métricas del día, solicitudes proactivas urgentes y solicitudes reactivas recientes. (${REPON_AUTH_PACKAGE_ID})`}
      />
      <AuthWiringProbe />
    </>
  );
}
