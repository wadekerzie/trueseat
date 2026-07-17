import WitnessClient from "./WitnessClient";

export const metadata = {
  title: "TrueSeat — Five-minute reference",
  robots: { index: false },
};

export default async function WitnessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <WitnessClient token={token} />;
}
