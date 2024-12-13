import Svg from "@/public/xerak0_Create_a_battered_colorful_isometric_minimalistic_illu_6a883a6a-189f-40af-927a-58e9fb1ef0e7_1 2.svg";
import { getOwnerBalance, getOwnedIds } from "@/contract/read-contract";

export default async function Home() {
  const ids = await getOwnedIds("0x955CC6748A15Cf59577185148C21A7d278e53D71");

  console.log(ids);

  return (
    <div className="w-full h-full flex justify-center items-center">
      <Svg className="" />
    </div>
  );
}
