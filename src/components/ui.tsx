import { createContext, useContext } from 'react';
import type { Occurrence, Task } from '@/lib/types';

export interface UiApi {
  openEditor: (opts?: { occ?: Occurrence; draft?: Partial<Task> }) => void;
  openVoice: (autoStart?: boolean) => void;
  navigate: (route: Route) => void;
}
export type Route = 'today' | 'calendar' | 'inbox' | 'more' | 'stats' | 'settings' | 'search' | 'favorites' | 'archive';

export const UiContext = createContext<UiApi>({ openEditor: () => {}, openVoice: () => {}, navigate: () => {} });
export const useUi = () => useContext(UiContext);
