<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import { snackbar } from '$lib/stores/snackbar';
	import { goto } from '$app/navigation';

	let { form }: { form: ActionData } = $props();
	
	let activeTab = $state<'signin' | 'signup'>('signin');
	
	// 控制是否显示错误消息的状态
	let showMessage = $state(true);

	// 当 form 更新时（提交表单后），重置 showMessage 为 true
	$effect(() => {
		form; 
		showMessage = true;
	});

	function switchTab(tab: 'signin' | 'signup') {
		activeTab = tab;
		// 切换标签时，隐藏之前的错误消息
		showMessage = false;
	}

	// 派生出最终显示的消息
	let displayMessage = $derived(showMessage ? form?.message : undefined);
</script>

<div class="min-h-screen w-full flex items-center justify-center bg-linear-to-br from-[#667eea] to-[#764ba2] p-4">
	<div class="w-full max-w-[400px] overflow-hidden rounded-xl bg-white shadow-2xl">
		{#if activeTab === 'signin'}
			<div class="p-8">
				<h2 class="mb-6 text-center text-2xl font-bold text-gray-800">欢迎回来</h2>
				<form 
					method="post" 
					action="?/signin" 
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'redirect') {
								snackbar.show('登录成功', 'success');
								await update(); // This will trigger the redirect
							} else {
								await update();
							}
						};
					}}
				>
					<div class="mb-5">
						<label for="signin-phone" class="mb-2 block text-sm font-medium text-gray-700">手机号码</label>
						<input
							id="signin-phone"
							name="phoneNumber"
							type="tel"
							placeholder="请输入您的手机号码"
							required
							class="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-base transition-all duration-300 focus:border-[#667eea] focus:outline-none focus:ring-4 focus:ring-[#667eea]/10"
						/>
					</div>
					<div class="mb-5">
						<label for="signin-password" class="mb-2 block text-sm font-medium text-gray-700">密码</label>
						<input
							id="signin-password"
							name="password"
							type="password"
							placeholder="请输入您的密码"
							required
							class="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-base transition-all duration-300 focus:border-[#667eea] focus:outline-none focus:ring-4 focus:ring-[#667eea]/10"
						/>
					</div>
					{#if displayMessage}
						<p class="mb-3 rounded-md border-l-4 border-red-500 bg-red-50 p-2 text-sm text-red-600">{displayMessage}</p>
					{/if}
					<button type="submit" class="mt-2 w-full rounded-lg bg-linear-to-br from-[#667eea] to-[#764ba2] px-4 py-3.5 text-base font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0">登录</button>
				</form>
				<div class="mt-6 text-center text-sm text-gray-600">
					还没有账户？ <button onclick={() => switchTab('signup')} class="font-medium text-[#667eea] hover:text-[#764ba2] hover:underline cursor-pointer">立即注册</button>
				</div>
			</div>
		{:else}
			<div class="p-8">
				<h2 class="mb-6 text-center text-2xl font-bold text-gray-800">创建账户</h2>
				<form 
					method="post" 
					action="?/signup" 
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'redirect') {
								snackbar.show('注册成功', 'success');
								await update(); // This will trigger the redirect
							} else {
								await update();
							}
						};
					}}
				>
					<div class="mb-5">
						<label for="signup-phone" class="mb-2 block text-sm font-medium text-gray-700">手机号码</label>
						<input
							id="signup-phone"
							name="phoneNumber"
							type="tel"
							placeholder="请输入您的手机号码"
							required
							class="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-base transition-all duration-300 focus:border-[#667eea] focus:outline-none focus:ring-4 focus:ring-[#667eea]/10"
						/>
					</div>
					<div class="mb-5">
						<label for="signup-password" class="mb-2 block text-sm font-medium text-gray-700">密码</label>
						<input
							id="signup-password"
							name="password"
							type="password"
							placeholder="请设置您的密码 (至少6位)"
							required
							class="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-base transition-all duration-300 focus:border-[#667eea] focus:outline-none focus:ring-4 focus:ring-[#667eea]/10"
						/>
					</div>
					<div class="mb-5">
						<label for="signup-confirm-password" class="mb-2 block text-sm font-medium text-gray-700">确认密码</label>
						<input
							id="signup-confirm-password"
							name="confirmPassword"
							type="password"
							placeholder="请再次输入您的密码"
							required
							class="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-base transition-all duration-300 focus:border-[#667eea] focus:outline-none focus:ring-4 focus:ring-[#667eea]/10"
						/>
					</div>
					<div class="mb-4">
						<label class="flex items-start gap-2 text-sm font-normal text-gray-600 cursor-pointer">
							<input
								type="checkbox"
								name="agreedToTerms"
								required
								class="mt-0.5 cursor-pointer accent-[#667eea]"
							/>
							<span>我已阅读并同意 <a href="/terms" target="_blank" class="text-[#667eea] hover:text-[#764ba2] hover:underline">用户协议</a></span>
						</label>
					</div>
					{#if displayMessage}
						<p class="mb-3 rounded-md border-l-4 border-red-500 bg-red-50 p-2 text-sm text-red-600">{displayMessage}</p>
					{/if}
					<button type="submit" class="mt-2 w-full rounded-lg bg-linear-to-br from-[#667eea] to-[#764ba2] px-4 py-3.5 text-base font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0">注册</button>
				</form>
				<div class="mt-6 text-center text-sm text-gray-600">
					已有账户？ <button onclick={() => switchTab('signin')} class="font-medium text-[#667eea] hover:text-[#764ba2] hover:underline cursor-pointer">立即登录</button>
				</div>
			</div>
		{/if}
	</div>
</div>
