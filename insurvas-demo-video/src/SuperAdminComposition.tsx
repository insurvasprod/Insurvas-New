import { CalculateMetadataFunction, Composition, Series } from "remotion";
import { SuperAdminIntro } from "./superadmin/Intro";
import { SuperAdminAuth } from "./superadmin/Auth";
import { SuperAdminOverview } from "./superadmin/Overview";
import { SuperAdminTenants } from "./superadmin/Tenants";
import { SuperAdminUsers } from "./superadmin/Users";
import { SuperAdminCatalog } from "./superadmin/Catalog";
import { SuperAdminBilling } from "./superadmin/Billing";
import { SuperAdminConfiguration } from "./superadmin/Configuration";
import { SuperAdminGovernance } from "./superadmin/Governance";
import { SuperAdminOutro } from "./superadmin/Outro";

type Props = Record<string, unknown>;
const DURATION = 2010;
const calculateMetadata: CalculateMetadataFunction<Props> = () => ({ durationInFrames: DURATION });

export const SuperAdminComposition = () => (
  <Composition id="InsurvasSuperAdmin" component={SuperAdminComponent} durationInFrames={DURATION} fps={30} width={1280} height={720} calculateMetadata={calculateMetadata} />
);

export const SuperAdminComponent: React.FC<Props> = () => (
  <Series>
    <Series.Sequence durationInFrames={90} name="01 Super Admin Intro"><SuperAdminIntro /></Series.Sequence>
    <Series.Sequence durationInFrames={180} name="02 Secure Access"><SuperAdminAuth /></Series.Sequence>
    <Series.Sequence durationInFrames={180} name="03 Control Plane Overview"><SuperAdminOverview /></Series.Sequence>
    <Series.Sequence durationInFrames={240} name="04 Tenant Operations"><SuperAdminTenants /></Series.Sequence>
    <Series.Sequence durationInFrames={210} name="05 User Administration"><SuperAdminUsers /></Series.Sequence>
    <Series.Sequence durationInFrames={210} name="06 Catalog and Entitlements"><SuperAdminCatalog /></Series.Sequence>
    <Series.Sequence durationInFrames={240} name="07 Billing and Revenue"><SuperAdminBilling /></Series.Sequence>
    <Series.Sequence durationInFrames={270} name="08 Configuration Center"><SuperAdminConfiguration /></Series.Sequence>
    <Series.Sequence durationInFrames={240} name="09 Governance and Audit"><SuperAdminGovernance /></Series.Sequence>
    <Series.Sequence durationInFrames={150} name="10 Super Admin Duties"><SuperAdminOutro /></Series.Sequence>
  </Series>
);
