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
    avatar?: string;
  }