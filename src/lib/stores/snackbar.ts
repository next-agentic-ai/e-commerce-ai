import { writable } from 'svelte/store';

export type SnackbarType = 'success' | 'error' | 'info';

export interface SnackbarState {
	message: string;
	type: SnackbarType;
	isVisible: boolean;
	duration?: number;
}

function createSnackbarStore() {
	const { subscribe, set, update } = writable<SnackbarState>({
		message: '',
		type: 'info',
		isVisible: false
	});

	let timeoutId: ReturnType<typeof setTimeout>;

	return {
		subscribe,
		show: (message: string, type: SnackbarType = 'info', duration = 3000) => {
			clearTimeout(timeoutId);
			set({ message, type, isVisible: true, duration });

			if (duration > 0) {
				timeoutId = setTimeout(() => {
					update((state) => ({ ...state, isVisible: false }));
				}, duration);
			}
		},
		hide: () => {
			clearTimeout(timeoutId);
			update((state) => ({ ...state, isVisible: false }));
		}
	};
}

export const snackbar = createSnackbarStore();

