import { hash, verify } from '@node-rs/argon2';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}
	return {};
};

export const actions: Actions = {
	signin: async (event) => {
		const formData = await event.request.formData();
		const phoneNumber = formData.get('phoneNumber');
		const password = formData.get('password');

		if (!validatePhoneNumber(phoneNumber)) {
			return fail(400, {
				message: '无效的手机号码'
			});
		}
		if (!validatePassword(password)) {
			return fail(400, { message: '无效的密码（至少6位，最多255位）' });
		}

		const results = await db.select().from(table.user).where(eq(table.user.phoneNumber, phoneNumber));

		const existingUser = results.at(0);
		if (!existingUser) {
			return fail(400, { message: '手机号码或密码错误' });
		}

		const validPassword = await verify(existingUser.passwordHash, password, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});
		if (!validPassword) {
			return fail(400, { message: '手机号码或密码错误' });
		}

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, existingUser.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		return redirect(302, '/');
	},
	signup: async (event) => {
		const formData = await event.request.formData();
		const phoneNumber = formData.get('phoneNumber');
		const password = formData.get('password');
		const confirmPassword = formData.get('confirmPassword');
		const agreedToTerms = formData.get('agreedToTerms');

		if (!validatePhoneNumber(phoneNumber)) {
			return fail(400, { message: '无效的手机号码' });
		}
		if (!validatePassword(password)) {
			return fail(400, { message: '无效的密码（至少6位，最多255位）' });
		}
		if (password !== confirmPassword) {
			return fail(400, { message: '两次输入的密码不一致' });
		}
		if (agreedToTerms !== 'on') {
			return fail(400, { message: '您必须同意用户协议' });
		}

		// Check if phone number already exists
		const existingUsers = await db.select().from(table.user).where(eq(table.user.phoneNumber, phoneNumber));
		if (existingUsers.length > 0) {
			return fail(400, { message: '手机号码已被注册' });
		}

		const userId = generateUserId();
		const passwordHash = await hash(password, {
			// recommended minimum parameters
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		try {
			await db.insert(table.user).values({ 
				id: userId, 
				nickname: phoneNumber, // Use phone number as nickname
				phoneNumber, 
				passwordHash 
			});

			const sessionToken = auth.generateSessionToken();
			const session = await auth.createSession(sessionToken, userId);
			auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
		} catch {
			return fail(500, { message: '发生错误，请稍后重试' });
		}
		return redirect(302, '/');
	}
};

function generateUserId() {
	// ID with 120 bits of entropy, or about the same as UUID v4.
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return id;
}

function validatePhoneNumber(phoneNumber: unknown): phoneNumber is string {
	// Basic phone number validation - can be adjusted based on requirements
	return (
		typeof phoneNumber === 'string' &&
		phoneNumber.length >= 10 &&
		phoneNumber.length <= 15 &&
		/^[0-9+\-\s()]+$/.test(phoneNumber)
	);
}

function validatePassword(password: unknown): password is string {
	return typeof password === 'string' && password.length >= 6 && password.length <= 255;
}

