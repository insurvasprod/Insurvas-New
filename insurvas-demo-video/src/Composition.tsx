import { CalculateMetadataFunction, Composition, Series } from "remotion";
import { Intro } from "./scenes/Intro";
import { Signup } from "./scenes/Signup";
import { Subscribe } from "./scenes/Subscribe";
import { Access } from "./scenes/Access";
import { Dashboard } from "./scenes/Dashboard";
import { Outro } from "./scenes/Outro";

type Props = Record<string, unknown>;

const calculateMetadata: CalculateMetadataFunction<Props> = () => ({ durationInFrames: 1110 });

export const MyComposition = () => (
  <Composition id="InsurvasDemo" component={MyComponent} durationInFrames={1110} fps={30} width={1280} height={720} calculateMetadata={calculateMetadata} />
);

export const MyComponent: React.FC<Props> = () => (
  <Series>
    <Series.Sequence durationInFrames={90} name="01 Intro"><Intro /></Series.Sequence>
    <Series.Sequence durationInFrames={210} name="02 Signup"><Signup /></Series.Sequence>
    <Series.Sequence durationInFrames={195} name="03 Subscription"><Subscribe /></Series.Sequence>
    <Series.Sequence durationInFrames={180} name="04 Access"><Access /></Series.Sequence>
    <Series.Sequence durationInFrames={300} name="05 Workspace"><Dashboard /></Series.Sequence>
    <Series.Sequence durationInFrames={135} name="06 Outro"><Outro /></Series.Sequence>
  </Series>
);
