import React, { useState } from 'react';
import { Button, Input, Select, Form, message } from 'antd';
import { Contract } from '~components/generated-models';
import { pathOr } from 'ramda';
import { useMutation, useQuery } from '@apollo/react-hooks';
import {
  CREATE_GROUP_CHAT_MUTATION,
  ADD_CHAT_MEMBER_MUTATION,
  GET_CONTRACT_MEMBERS
} from '~graphql/chats.graphql';
import { CurrentUser } from '~lib/withSession';
import { User } from '~components/generated-models';
import { SEND_MESSAGE_MUTATION } from '~graphql/messages.graphql';

interface AddTaskModalProps {
  contract: Contract;
  user: CurrentUser;
  closeModal: () => void;
}

const { Option } = Select;
const GroupTopic = ({
  contract,
  user: currentUser,
  closeModal
}: AddTaskModalProps) => {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState({
    value: '',
    error: false
  });
  const [formMessage, setMessage] = useState({
    value: '',
    error: false
  });
  const [selectedMemberIds, handleChange] = useState([]);
  const [createGroupChat] = useMutation(CREATE_GROUP_CHAT_MUTATION);
  const [sendMessage] = useMutation(SEND_MESSAGE_MUTATION);
  const [addChatMember] = useMutation(ADD_CHAT_MEMBER_MUTATION);

  const { data: contractMembersData } = useQuery(GET_CONTRACT_MEMBERS, {
    variables: {
      contractId: contract.id
    }
  });

  const renderModalFooter = () => {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            paddingTop: '10px',
            borderTop: '1px solid #e8e8e8',
            borderRadius: '0 0 4px 4px'
          }}
        >
          <Button
            key="back"
            style={{
              marginRight: '15px'
            }}
            onClick={() => closeModal()}
            data-cy="add-task-modal-owner__cancel-btn"
          >
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            Group Topic
          </Button>
        </div>
      </div>
    );
  };

  const getUserFullName = (user: Pick<User, 'firstName' | 'lastName'>) => {
    return `${user.firstName || 'User'} ${user.lastName || ''}`;
  };

  const onMessageSend = async (chatId: string) => {
    const { value: text } = formMessage;
    if (text.replace(/\n\r?/g, '') === '') return;
    await sendMessage({
      variables: { chatId: chatId, text: text, files: [] }
    });
  };

  const onMemberAdd = async (chatId: string) => {
    const addMemberPromises = selectedMemberIds.map(memberId =>
      addChatMember({ variables: { chatId, memberId } })
    );

    try {
      await Promise.all([...addMemberPromises]);

      handleChange([]);
      setLoading(false);
    } catch (e) {
      handleChange([]);
      setLoading(false);
    }
  };

  const onSubmit = async e => {
    e.preventDefault();

    const { value: titleValue } = title;

    const newTitle = titleValue.trim();

    if (newTitle.replace(/\n\r?/g, '') === '') {
      return message.error('Title is required');
    }
    if (newTitle.toLowerCase() === 'general') {
      return setTitle({ ...title, error: true });
    }
    setLoading(true);

    if (createGroupChat) {
      try {
        const response = await createGroupChat({
          variables: { contractId: contract.id, title: newTitle }
        });
        const {
          data: {
            createGroupChat: { id: chatId }
          }
        } = response;

        await onMemberAdd(chatId);
        await onMessageSend(chatId);
        message.success('Group was created');
        closeModal();
      } catch (error) {
        message.error('Something went wrong...');
      }
    }

    setTitle({ value: '', error: false });
    setMessage({ value: '', error: false });
    setLoading(false);
  };

  const updateTitle = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTitle({ value: event.target.value, error: false });
  };

  const updateMessage = event => {
    setMessage({ value: event.target.value, error: false });
  };
  const titleStatus = title.error ? 'error' : 'success';
  const titleHelpText = title.error ? 'General chat already exists' : '';

  const messageStatus = formMessage.error ? 'error' : 'success';
  const messageHelpText = formMessage.error
    ? 'General chat already exists'
    : '';
  const getContractMembers = pathOr(
    [],
    ['getContractMembers'],
    contractMembersData
  );

  const users = getContractMembers.filter(({ user }) => {
    return user.id !== currentUser.id;
  });
  return (
    <div>
      <Form onSubmit={onSubmit}>
        <Form.Item validateStatus={titleStatus} help={titleHelpText}>
          <Input
            data-cy="group-chat-title-input"
            placeholder="Group chat title"
            value={title.value}
            onInput={updateTitle}
          />
        </Form.Item>

        <Form.Item validateStatus={messageStatus} help={messageHelpText}>
          <Input.TextArea
            data-cy="group-topic-message"
            placeholder="Message..."
            value={formMessage.value}
            onInput={updateMessage}
            rows={4}
          />
        </Form.Item>
        <Form.Item>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Select members"
            value={selectedMemberIds}
            maxTagTextLength={14}
            onChange={handleChange}
          >
            {users.map(({ id, user }) => (
              <Option key={id}>{getUserFullName(user)}</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item>{renderModalFooter()}</Form.Item>
      </Form>
    </div>
  );
};

export default GroupTopic;
