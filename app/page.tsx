import RadarApp from '@/components/radar-app';
import { catalog } from '@/lib/db';
export const dynamic='force-dynamic';
export default function Page(){return <RadarApp initial={catalog()}/>;}
