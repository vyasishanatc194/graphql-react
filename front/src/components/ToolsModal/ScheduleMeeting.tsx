import React, { useState } from 'react';
import {
  Button,
  Input,
  Select,
  Form,
  TimePicker,
  DatePicker,
  message
} from 'antd';
import { pathOr } from 'ramda';
import moment from 'moment';
import { Contract } from '~components/generated-models';
import { useQuery, useMutation } from '@apollo/react-hooks';
import { CurrentUser } from '~lib/withSession';
import { User } from '~components/generated-models';
import { GET_CONTRACT_MEMBERS, SCHEDULE_MEETING } from '~graphql/chats.graphql';
import styles from './ToolsModal.module.less';
import { styled } from '~utils/styled';

const DURATION = [
  {
    value: 15,
    label: '15 Min'
  },
  {
    value: 30,
    label: '30 Min'
  },
  {
    value: 60,
    label: '1 Hour'
  },
  {
    value: 120,
    label: '2 Hour'
  }
];
const format = 'HH:mm';

interface ScheduleMeetingProps {
  contract: Contract;
  closeModal: () => void;
  user: CurrentUser;
}
const { Option } = Select;
const { Item } = Form;

const ScheduleFormItemWrapper = styled(styles.scheduleFormItemWrapper);
const ScheduleFormItem = styled(styles.scheduleFormItem, Item);
const ScheduleMeeting = ({ contract, closeModal }: ScheduleMeetingProps) => {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({
    meetingName: false,
    location: false,
    selectedMemberIds: false,
    selectedDuration: false,
    selectedDate: false,
    selectedTime: false
  });
  const [meetingName, setMeetingName] = useState({
    value: '',
    error: false
  });
  const [details, setDetails] = useState({
    value: '',
    error: false
  });
  const [location, setLocation] = useState({
    value: '',
    error: false
  });
  const [selectedMemberIds, handleChangeMemberIds] = useState([]);
  const [selectedDuration, handleChangeDuration] = useState();
  const [selectedDate, handleChangeDate] = useState(moment());
  const [selectedTime, handleChangeTime] = useState(moment());

  const { data: contractMembersData } = useQuery(GET_CONTRACT_MEMBERS, {
    variables: {
      contractId: contract.id
    }
  });
  const resetFields = () => {
    setLoading(false);
    setMeetingName({ value: '', error: false });
    setDetails({ value: '', error: false });
    setLocation({ value: '', error: false });
    handleChangeMemberIds([]);
    handleChangeDuration(undefined);
    handleChangeDate(moment());
    handleChangeTime(moment());
  };
  const validateForm = () => {
    let meetingNameError = false;
    let locationError = false;
    let selectedMemberIdsError = false;
    let selectedDurationError = false;
    let selectedDateError = false;
    let selectedTimeError = false;
    let isError = false;

    if (!meetingName.value) {
      meetingNameError = true;
      isError = true;
    }
    if (!location.value) {
      locationError = true;
      isError = true;
    }
    if (!selectedMemberIds.length) {
      selectedMemberIdsError = true;
      isError = true;
    }
    if (!selectedDuration) {
      selectedDurationError = true;
      isError = true;
    }
    if (!selectedDate) {
      selectedDateError = true;
      isError = true;
    }
    if (!selectedTime) {
      selectedTimeError = true;
      isError = true;
    }
    setErrors({
      meetingName: meetingNameError,
      location: locationError,
      selectedMemberIds: selectedMemberIdsError,
      selectedDuration: selectedDurationError,
      selectedDate: selectedDateError,
      selectedTime: selectedTimeError
    });

    return isError;
  };
  const [scheduleMeeting] = useMutation(SCHEDULE_MEETING);

  const getUserFullName = (user: Pick<User, 'firstName' | 'lastName'>) => {
    return `${user.firstName || 'User'} ${user.lastName || ''}`;
  };

  const onScheduleMeeting = async () => {
    const isValidateFormError = await validateForm();

    if (isValidateFormError) return;

    const filteredUsers = users
      .filter(user => selectedMemberIds.includes(user.id))
      .map(({ id, user }) => ({
        memberId: id,
        email: user.email,
        actionType: 'Create'
      }));

    if (!selectedDate || !selectedTime) {
      return;
    }

    const [month, day, year] = moment(selectedDate)
      .format('L')
      .split('/');
    const [hour, minutes] = moment(selectedTime)
      .format('HH:mm')
      .split(':');
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minutes),
      0
    );
    const input = {
      name: meetingName.value,
      date: date,
      duration: parseInt(selectedDuration),
      location: location.value,
      details: details.value,
      guests: filteredUsers
    };
    try {
      await scheduleMeeting({
        variables: { contractId: contract.id, input: input }
      });
      message.success('Meeting was scheduled');
      resetFields();
      closeModal();
    } catch (error) {
      message.error('Something went wrong...');
    }
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
          <Button
            onClick={e => {
              e.preventDefault();
              onScheduleMeeting();
            }}
            type="primary"
            htmlType="submit"
            loading={loading}
          >
            Schedule
          </Button>
        </div>
      </div>
    );
  };
  const updateMeetingName = (event: React.ChangeEvent<HTMLInputElement>) => {
    setMeetingName({ value: event.target.value, error: false });
  };
  const updateDetails = (event: any) => {
    setDetails({ value: event.target.value, error: false });
  };
  const updateLocation = (event: any) => {
    setLocation({ value: event.target.value, error: false });
  };

  const users = pathOr([], ['getContractMembers'], contractMembersData);

  const meetingNameStatus = errors.meetingName ? 'error' : 'success';
  const locationStatus = errors.location ? 'error' : 'success';

  return (
    <div>
      <Form>
        <Form.Item
          validateStatus={meetingNameStatus}
          help={errors.meetingName ? 'Meeting Name is Required' : ''}
        >
          <Input
            data-cy="meeting-name-input"
            placeholder="Meeting Name"
            value={meetingName.value}
            onInput={updateMeetingName}
          />
        </Form.Item>
        <ScheduleFormItemWrapper>
          <ScheduleFormItem
            validateStatus={errors.selectedDate ? 'error' : 'success'}
            help={errors.selectedDate ? 'Date is Required' : ''}
          >
            <DatePicker
              data-cy="meeting-date"
              style={{
                width: '100%'
              }}
              format="MM/DD/YYYY"
              value={selectedDate}
              onChange={e => handleChangeDate(e)}
            />
          </ScheduleFormItem>
          <ScheduleFormItem
            validateStatus={errors.selectedTime ? 'error' : 'success'}
            help={errors.selectedTime ? 'Time is Required' : ''}
          >
            <TimePicker
              style={{
                width: '100%'
              }}
              value={selectedTime}
              onChange={e => handleChangeTime(e)}
              format={format}
            />
          </ScheduleFormItem>
          <ScheduleFormItem
            validateStatus={errors.selectedDuration ? 'error' : 'success'}
            help={errors.selectedDuration ? 'Duration is Required' : ''}
          >
            <Select
              data-cy="meeting-duration-select"
              style={{ width: '100%' }}
              placeholder="Duration"
              value={selectedDuration}
              maxTagTextLength={14}
              onChange={handleChangeDuration}
            >
              {DURATION.map(({ value, label }) => (
                <Option key={value}>{label}</Option>
              ))}
            </Select>
          </ScheduleFormItem>
        </ScheduleFormItemWrapper>
        <Form.Item
          validateStatus={locationStatus}
          help={errors.location ? 'Location is Required' : ''}
        >
          <Input
            data-cy="meeting-location-input"
            placeholder="Location"
            value={location.value}
            onInput={updateLocation}
          />
        </Form.Item>
        <Form.Item>
          <Input.TextArea
            data-cy="meeting-details-input"
            placeholder="Details..."
            value={details.value}
            onInput={updateDetails}
            rows={4}
          />
        </Form.Item>
        <Form.Item
          validateStatus={errors.selectedMemberIds ? 'error' : 'success'}
          help={errors.selectedMemberIds ? 'Guests is Required' : ''}
        >
          <Select
            data-cy="meeting-guests-select"
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Select Guests"
            value={selectedMemberIds}
            maxTagTextLength={14}
            onChange={handleChangeMemberIds}
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

export default ScheduleMeeting;
