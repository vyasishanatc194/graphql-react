import React, { useState } from 'react';
import { Button, Input, Select, Form, DatePicker } from 'antd';
import { pathOr } from 'ramda';
import { Contract } from '~components/generated-models';
import { useQuery } from '@apollo/react-hooks';
import { CurrentUser } from '~lib/withSession';
import { User } from '~components/generated-models';
import { GET_CONTRACT_MEMBERS } from '~graphql/chats.graphql';

interface TrackItemProps {
  contract: Contract;
  closeModal: () => void;
  user: CurrentUser;
}
const { Option } = Select;

const TrackItem = ({
  contract,
  user: currentUser,
  closeModal
}: TrackItemProps) => {
  const [openItem, setOpenItem] = useState({
    value: '',
    error: false
  });
  const [selectedMemberIds, handleChangeMemberIds] = useState([]);
  const [selectedDate, handleChangeDate] = useState();
  const [related, setRelated] = useState('');
  const [loading] = useState(false);

  const { data: contractMembersData } = useQuery(GET_CONTRACT_MEMBERS, {
    variables: {
      contractId: contract.id
    }
  });

  const getUserFullName = (user: Pick<User, 'firstName' | 'lastName'>) => {
    return `${user.firstName || 'User'} ${user.lastName || ''}`;
  };
  const onSubmit = () => {};

  const updateOpenItem = (event: React.ChangeEvent<HTMLInputElement>) => {
    setOpenItem({ value: event.target.value, error: false });
  };

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
            Create
          </Button>
        </div>
      </div>
    );
  };
  const getContractMembers = pathOr(
    [],
    ['getContractMembers'],
    contractMembersData
  );
  const users = getContractMembers.filter(({ user }: any) => {
    return user.id !== currentUser.id;
  });

  const meetingNameStatus = openItem.error ? 'error' : 'success';
  return (
    <div>
      <Form onSubmit={onSubmit}>
        <Form.Item validateStatus={meetingNameStatus}>
          <Input
            placeholder="Open Item"
            value={openItem.value}
            onInput={updateOpenItem}
          />
        </Form.Item>

        <Form.Item>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Assignee"
            value={selectedMemberIds}
            maxTagTextLength={14}
            onChange={handleChangeMemberIds}
          >
            {users.map(({ id, user }) => (
              <Option key={id}>{getUserFullName(user)}</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item>
          <DatePicker
            style={{
              width: '100%'
            }}
            value={selectedDate}
            onChange={e => handleChangeDate(e)}
          />
        </Form.Item>

        <Form.Item validateStatus={meetingNameStatus}>
          <Input
            placeholder="Related"
            value={related}
            onInput={(e: any) => setRelated(e.target.value)}
          />
        </Form.Item>

        <Form.Item>{renderModalFooter()}</Form.Item>
      </Form>
    </div>
  );
};

export default TrackItem;
