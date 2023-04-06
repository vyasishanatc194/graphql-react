import React, { Fragment } from 'react';
import { isEmpty } from 'ramda';
import { TaskForm } from '~layouts/manage';
import { Button, Tooltip, message } from 'antd';
import {
  Contract,
  Task,
  TaskboardCreateChangeOrderComponent
} from '~components/generated-models';

import {
  removeNullFields,
  getTaskForUpload
} from '~layouts/manage/shared/AddTaskModal/utils';
import { CurrentUser } from '~lib/withSession';
import { isOwner } from '~utils/role';
import '~layouts/manage/shared/AddTaskModal/styles/AddTaskModal.less';

interface AddTaskModalProps {
  contract: Contract;
  user: CurrentUser;
  allTasks?: Array<Task>;
  refetchQueries?: Array<string>;
  closeModal: () => void;
}

const CreateNewTask = (props: AddTaskModalProps) => {
  const formRef = React.createRef<any>();

  const handleAddNewTask = (createChangeOrder: Function) => async () => {
    const {
      contract: { id: contractId, phases },
      refetchQueries,
      closeModal
    } = props;

    const taskForm = formRef && formRef.current && formRef.current.state;

    if (!taskForm) {
      return;
    }

    let taskForChangeOrder;
    try {
      taskForChangeOrder = await getTaskForUpload({
        task: taskForm,
        phases
      });
    } catch (error) {
      if (error) throw error;
      return;
    }

    if (isEmpty(taskForChangeOrder.name)) {
      return message.error('Task name is required');
    }

    if (
      isEmpty(taskForChangeOrder.phaseId) ||
      isEmpty(taskForChangeOrder.phaseName)
    ) {
      return message.error('Task phase is required');
    }

    try {
      await createChangeOrder({
        variables: {
          contractId,
          input: {
            note: taskForm.changeOrderComment,
            reason: taskForm.reason
          },
          tasks: [removeNullFields(taskForChangeOrder)]
        },
        refetchQueries
      });

      message.success('Successfully added change order for creating the task');
      closeModal();
    } catch (error) {
      message.error('Something went wrong...');

      throw error;
    }
  };

  const renderModalFooter = () => {
    const {
      contract: { phases: contractPhases = [] },
      closeModal
    } = props;

    const phasesToDisplay = contractPhases.filter(
      contractPhase => contractPhase.funded
    );

    const isNoPhasesToDisplay = isEmpty(phasesToDisplay);
    const infoTooltip = isNoPhasesToDisplay ? (
      <div>Please, select some phase</div>
    ) : null;

    return (
      <TaskboardCreateChangeOrderComponent>
        {(createChangeOrder: Function, { loading }) => {
          return (
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
              <Tooltip title={infoTooltip} key="submit">
                <Button
                  type="primary"
                  onClick={handleAddNewTask(createChangeOrder)}
                  disabled={isNoPhasesToDisplay || loading}
                  loading={loading}
                  data-cy="add-task-modal__create-task-btn"
                >
                  Create new task
                </Button>
              </Tooltip>
            </div>
          );
        }}
      </TaskboardCreateChangeOrderComponent>
    );
  };
  const { contract, user, allTasks } = props;

  const isUserOwner = isOwner(user);

  return (
    <TaskForm
      ref={formRef}
      contract={contract}
      userData={user}
      allTasks={isUserOwner ? [] : allTasks}
    >
      <div className="add-task-modal__add-task-row">
        <div className="add-task-modal__add-task-column add-task-modal__add-task-column--name">
          <TaskForm.Name />
        </div>
        <div className="add-task-modal__add-task-column">
          <TaskForm.Reason />
        </div>
      </div>
      <div className="add-task-modal__add-task-row add-task-modal__add-task-comment-container">
        <TaskForm.Assignees />
      </div>
      <div className="add-task-modal__add-task-row add-task-modal__add-task-comment-container">
        <TaskForm.Description />
      </div>
      <div className="add-task-modal__add-task-row">
        <div className="add-task-modal__add-task-column">
          <TaskForm.DivisionTrade />
        </div>
        <div className="add-task-modal__add-task-column">
          <TaskForm.Room />
        </div>
        <div className="add-task-modal__add-task-column">
          <TaskForm.Phases />
        </div>
      </div>
      <div className="add-task-modal__add-task-row">
        <div className="add-task-modal__add-task-column">
          <TaskForm.StartTaskDate />
        </div>
        <div className="add-task-modal__add-task-column">
          <TaskForm.EndTaskDate />
        </div>
        <div className="add-task-modal__add-task-column">
          <TaskForm.DiffTaskDays />
        </div>
      </div>
      {!isUserOwner && (
        <Fragment>
          <div className="add-task-modal__add-task-row">
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskCurrencyInput
                title="Material Cost"
                fieldName="materialCost"
              />
            </div>
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskCurrencyInput
                title="Labor Cost"
                fieldName="laborCost"
              />
            </div>
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskCurrencyInput
                title="Other Cost"
                fieldName="otherCost"
              />
            </div>
          </div>
          <div className="add-task-modal__add-task-row">
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskCurrencyInput
                title="Sub Total"
                fieldName="subTotal"
                disabled
              />
            </div>
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskPercentageInput
                title="Markup Percent"
                fieldName="markupPercent"
              />
            </div>
            <div className="add-task-modal__add-task-column">
              <TaskForm.TaskCurrencyInput
                title="Markup Price"
                fieldName="markupPrice"
                disabled
              />
            </div>
          </div>
          <hr className="add-task-modal__add-task-separator" />
          <div className="add-task-modal__add-task-row-summary">
            <div className="add-task-modal__add-task-column-summary">
              <TaskForm.UploadBlock />
            </div>
            <div className="add-task-modal__add-task-column-summary-total">
              <TaskForm.TaskCurrencyInput
                title="Total"
                fieldName="totalPrice"
                disabled
              />
            </div>
          </div>
          <hr />
          <TaskForm.RelativeDays displayAnyway />
          <hr className="add-task-modal__add-task-separator" />
          <TaskForm.ChangeOrderComment fieldName="changeOrderComment" />
          <TaskForm.ChangeOrderDescription />
        </Fragment>
      )}
      {renderModalFooter()}
    </TaskForm>
  );
};

export default CreateNewTask;
