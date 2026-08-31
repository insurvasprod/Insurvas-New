import "./index.css";
import { MyComposition } from "./Composition";
import { SuperAdminComposition } from "./SuperAdminComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <SuperAdminComposition />
    </>
  );
};
