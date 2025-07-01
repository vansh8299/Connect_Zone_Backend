export interface CreateGroupInput {
    name: string;
    description?: string;
    participantIds: string[];
    avatarBase64?: string;
  }
  
  export interface UpdateGroupInput {
    groupId: string;
    name?: string;
    description?: string;
    avatarBase64?: string;
  }
  // Add these types to your types file
export interface DeleteMessageInput {
  messageId: string;
  deleteType: 'DELETE_FOR_EVERYONE' | 'DELETE_FOR_ME';
}

export interface DeleteMessageResponse {
  success: boolean;
  messageId: string;
  conversationId: string;
  deleteType: string;
}