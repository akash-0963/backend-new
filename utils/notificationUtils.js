const Notification = require('../modules/notification');
const User = require('../modules/user');
const admin = require('firebase-admin');

/**
 * Sends a push notification to a user's registered devices using FCM.
 * This is a helper function called by createNotification.
 * @param {string} recipientId - The ID of the user to notify.
 * @param {string} title - The title of the push notification.
 * @param {string} body - The main message content of the push notification.
 * @param {object} [data={}] - Optional data payload (e.g., postId) for the client app to handle.
 */
const sendPushNotification = async (recipientId, title, body, data = {}) => {
    try {
        // 1. Find the recipient user to get their device tokens
        const user = await User.findById(recipientId);

        // 2. Check if the user exists and has any registered device tokens
        if (!user || !user.deviceTokens || user.deviceTokens.length === 0) {
            console.log("Push notification not sent: User not found or has no registered device tokens.");
            return;
        }

        // 3. Construct the push notification payload for FCM
        const message = {
            notification: {
                title, // e.g., "New Like"
                body,  // e.g., "John Doe liked your post."
            },
            tokens: user.deviceTokens, // Array of device tokens to send to
            data, // Optional data like { postId: '...' }
        };

        // 4. Send the message using the Firebase Admin SDK
        const response = await admin.messaging().sendMulticast(message);
        console.log('Successfully sent push notification:', response.successCount, 'messages');

        // Optional: Clean up invalid tokens from your database
        if (response.failureCount > 0) {
            const tokensToRemove = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success && (resp.error.code === 'messaging/registration-token-not-registered' || resp.error.code === 'messaging/invalid-registration-token')) {
                    tokensToRemove.push(user.deviceTokens[idx]);
                }
            });
            if(tokensToRemove.length > 0) {
                await User.updateOne({ _id: recipientId }, { $pullAll: { deviceTokens: tokensToRemove } });
                console.log('Removed invalid device tokens:', tokensToRemove.length);
            }
        }

    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};

/**
 * Creates and saves an in-app notification and triggers a push notification.
 * This is the main function you will call from your controllers.
 * @param {string} recipient - The ID of the user receiving the notification.
 * @param {string} sender - The ID of the user who triggered the notification.
 * @param {('like'|'comment'|'reply'|'follow'|'repost')} type - The type of notification.
 * @param {string} [postId=null] - The ID of the relevant post (optional).
 */
exports.createNotification = async (recipient, sender, type, postId = null) => {
    try {
        // Prevent users from receiving notifications for their own actions
        if (recipient.toString() === sender.toString()) {
            return;
        }

        const senderUser = await User.findById(sender);
        if (!senderUser) {
            console.error("Notification not created: Sender not found.");
            return;
        }

        // --- Part 1: Create the In-App Notification ---
        let message = '';
        let title = 'New Notification';
        switch (type) {
            case 'like':
                title = 'New Like';
                message = `${senderUser.name} liked your post.`;
                break;
            case 'comment':
                title = 'New Comment';
                message = `${senderUser.name} commented on your post.`;
                break;
            case 'reply':
                 title = 'New Reply';
                message = `${senderUser.name} replied to your comment.`;
                break;
            case 'follow':
                 title = 'New Follower';
                message = `${senderUser.name} started following you.`;
                break;
            case 'repost':
                 title = 'New Repost';
                message = `${senderUser.name} reposted your post.`;
                break;
            default:
                return;
        }

        // Save the notification to your MongoDB database
        const inAppNotification = new Notification({
            recipient,
            sender,
            type,
            message,
            postId,
        });
        await inAppNotification.save();
        console.log("In-app notification created successfully.");

        // --- Part 2: Trigger the Push Notification ---
        // This function is called immediately after the in-app notification is saved.
        await sendPushNotification(recipient, title, message, { postId: postId ? postId.toString() : '' });

    } catch (error) {
        console.error("Error creating notification:", error);
    }
};
